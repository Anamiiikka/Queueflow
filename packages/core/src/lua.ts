/**
 * The atomic heart of QueueFlow.
 *
 * Every multi-step queue operation is expressed as a single Lua script so Redis
 * runs it atomically — no two workers can ever observe an intermediate state.
 * This is what makes the queue correct under concurrency and crashes.
 *
 * Scoring convention (priority + FIFO in one number):
 *   pendingScore = priority * 1e13 + availableAtMs
 *   - priority is 1..5 (1 = most urgent) so it dominates the score.
 *   - availableAt (~enqueue time, in ms ≈ 1.7e12) breaks ties => FIFO within a priority.
 * The 1e13 bucket is larger than any realistic ms timestamp, so priorities never overlap.
 */

export const PRIORITY_BUCKET = 10_000_000_000_000; // 1e13

/**
 * enqueue: create the job hash and place it in pending (ready) or delayed (scheduled).
 * Honours idempotency keys — a duplicate key returns the existing job id without creating.
 *
 * KEYS[1]=pending  KEYS[2]=delayed  KEYS[3]=jobHash  KEYS[4]=idemKey
 * ARGV[1]=id  ARGV[2]=ready(0/1)  ARGV[3]=pendingScore  ARGV[4]=availableAt
 * ARGV[5]=hasIdem(0/1)  ARGV[6]=idemTtlSec  ARGV[7..]=field,value,... (hash)
 * returns {id, created(0/1)}
 */
export const ENQUEUE = `
local hasIdem = ARGV[5] == '1'
if hasIdem then
  local existing = redis.call('GET', KEYS[4])
  if existing then return {existing, 0} end
end

local fields = {}
for i = 7, #ARGV do fields[#fields + 1] = ARGV[i] end
redis.call('HSET', KEYS[3], unpack(fields))

if ARGV[2] == '1' then
  redis.call('ZADD', KEYS[1], tonumber(ARGV[3]), ARGV[1])
else
  redis.call('ZADD', KEYS[2], tonumber(ARGV[4]), ARGV[1])
end

if hasIdem then
  redis.call('SET', KEYS[4], ARGV[1], 'EX', tonumber(ARGV[6]))
end

return {ARGV[1], 1}
`;

/**
 * claim: atomically take the highest-priority ready job and lease it to a worker.
 * Moves it pending -> processing (scored by lease deadline) and bumps the attempt
 * counter. Counting attempts at claim time means a worker that crashes still "spends"
 * an attempt — so a poison job can't loop forever via repeated crashes.
 *
 * KEYS[1]=pending  KEYS[2]=processing
 * ARGV[1]=now  ARGV[2]=leaseMs  ARGV[3]=workerId  ARGV[4]=jobKeyPrefix
 * returns the job hash as a flat array (HGETALL), or nil if the queue is empty.
 */
export const CLAIM = `
local picked = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', '+inf', 'LIMIT', 0, 1)
if #picked == 0 then return nil end
local id = picked[1]
redis.call('ZREM', KEYS[1], id)

local lockedUntil = tonumber(ARGV[1]) + tonumber(ARGV[2])
redis.call('ZADD', KEYS[2], lockedUntil, id)

local jobKey = ARGV[4] .. id
redis.call('HSET', jobKey,
  'status', 'processing',
  'lockedBy', ARGV[3],
  'lockedUntil', lockedUntil,
  'updatedAt', ARGV[1])
redis.call('HINCRBY', jobKey, 'attempts', 1)
return redis.call('HGETALL', jobKey)
`;

/**
 * ack: a job finished successfully. Remove the lease, record the result.
 *
 * KEYS[1]=processing  KEYS[2]=jobHash
 * ARGV[1]=id  ARGV[2]=now  ARGV[3]=resultJson
 */
export const ACK = `
redis.call('ZREM', KEYS[1], ARGV[1])
redis.call('HSET', KEYS[2], 'status', 'completed', 'result', ARGV[3], 'updatedAt', ARGV[2])
redis.call('HDEL', KEYS[2], 'lockedBy', 'lockedUntil')
return 1
`;

/**
 * nack: an attempt failed. Retry (re-enter delayed at retryAt) or dead-letter once
 * attempts >= maxAttempts. The reaper uses the same retry/dead decision.
 *
 * KEYS[1]=processing  KEYS[2]=delayed  KEYS[3]=dlq  KEYS[4]=jobHash
 * ARGV[1]=id  ARGV[2]=now  ARGV[3]=retryAt  ARGV[4]=errorMsg
 * returns 'retry' or 'dead'
 */
export const NACK = `
redis.call('ZREM', KEYS[1], ARGV[1])
local attempts = tonumber(redis.call('HGET', KEYS[4], 'attempts')) or 0
local maxAttempts = tonumber(redis.call('HGET', KEYS[4], 'maxAttempts')) or 1
redis.call('HSET', KEYS[4], 'error', ARGV[4], 'updatedAt', ARGV[2])
redis.call('HDEL', KEYS[4], 'lockedBy', 'lockedUntil')

if attempts >= maxAttempts then
  redis.call('HSET', KEYS[4], 'status', 'dead')
  redis.call('LPUSH', KEYS[3], ARGV[1])
  return 'dead'
end

redis.call('HSET', KEYS[4], 'status', 'retrying', 'availableAt', ARGV[3])
redis.call('ZADD', KEYS[2], tonumber(ARGV[3]), ARGV[1])
return 'retry'
`;

/**
 * reaper: the fault-tolerance engine. Find leases whose deadline has passed
 * (the worker died or stalled) and requeue them — or dead-letter if exhausted.
 *
 * KEYS[1]=processing  KEYS[2]=pending  KEYS[3]=dlq
 * ARGV[1]=now  ARGV[2]=limit  ARGV[3]=jobKeyPrefix
 * returns the list of recovered (requeued) job ids.
 */
export const REAPER = `
local expired = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, tonumber(ARGV[2]))
local recovered = {}
for _, id in ipairs(expired) do
  redis.call('ZREM', KEYS[1], id)
  local jobKey = ARGV[3] .. id
  local attempts = tonumber(redis.call('HGET', jobKey, 'attempts')) or 0
  local maxAttempts = tonumber(redis.call('HGET', jobKey, 'maxAttempts')) or 1
  redis.call('HDEL', jobKey, 'lockedBy', 'lockedUntil')
  if attempts >= maxAttempts then
    redis.call('HSET', jobKey, 'status', 'dead', 'updatedAt', ARGV[1])
    redis.call('LPUSH', KEYS[3], id)
  else
    local priority = tonumber(redis.call('HGET', jobKey, 'priority')) or 5
    local score = priority * 10000000000000 + tonumber(ARGV[1])
    redis.call('HSET', jobKey, 'status', 'pending', 'updatedAt', ARGV[1])
    redis.call('ZADD', KEYS[2], score, id)
    recovered[#recovered + 1] = id
  end
end
return recovered
`;

/**
 * promote: move delayed/scheduled/retrying jobs whose time has come into pending.
 *
 * KEYS[1]=delayed  KEYS[2]=pending
 * ARGV[1]=now  ARGV[2]=limit  ARGV[3]=jobKeyPrefix
 * returns count promoted.
 */
export const PROMOTE = `
local due = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, tonumber(ARGV[2]))
for _, id in ipairs(due) do
  redis.call('ZREM', KEYS[1], id)
  local jobKey = ARGV[3] .. id
  local priority = tonumber(redis.call('HGET', jobKey, 'priority')) or 5
  local score = priority * 10000000000000 + tonumber(ARGV[1])
  redis.call('HSET', jobKey, 'status', 'pending', 'updatedAt', ARGV[1])
  redis.call('ZADD', KEYS[2], score, id)
end
return #due
`;

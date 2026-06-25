import type { Job, JobHandler } from "@queueflow/shared";

/**
 * Simulated job handlers. They mimic real async work (latency + occasional failure)
 * so retries, backoff, and the DLQ are demonstrable without external services.
 * Real implementations (SMTP, image lib, LLM call) slot in behind the same signature.
 */

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Fail with the given probability to exercise retry/backoff/DLQ paths. */
function maybeFail(probability: number, reason: string): void {
  if (Math.random() < probability) throw new Error(reason);
}

interface EmailPayload {
  to: string;
  subject: string;
}
const email: JobHandler<EmailPayload> = async (job: Job<EmailPayload>) => {
  await delay(50 + Math.random() * 100);
  maybeFail(0.2, "SMTP connection reset");
  return { delivered: true, to: job.payload.to };
};

interface ImagePayload {
  url: string;
  sizes?: number[];
}
const image: JobHandler<ImagePayload> = async (job: Job<ImagePayload>) => {
  await delay(150 + Math.random() * 250);
  maybeFail(0.1, "image decode failed");
  const sizes = job.payload.sizes ?? [256, 512];
  return { thumbnails: sizes.map((s) => `${job.payload.url}@${s}`) };
};

interface PdfPayload {
  invoiceId: string;
}
const pdf: JobHandler<PdfPayload> = async (job: Job<PdfPayload>) => {
  await delay(200 + Math.random() * 300);
  maybeFail(0.1, "pdf renderer timeout");
  return { file: `invoice-${job.payload.invoiceId}.pdf`, pages: 1 };
};

interface AiPayload {
  task: "summarize" | "tag" | "translate";
  text: string;
}
const ai: JobHandler<AiPayload> = async (job: Job<AiPayload>) => {
  await delay(300 + Math.random() * 500);
  maybeFail(0.15, "LLM rate limited");
  return { task: job.payload.task, output: `[${job.payload.task}] ${job.payload.text.slice(0, 24)}…` };
};

export const handlers: Record<string, JobHandler> = {
  email: email as JobHandler,
  image: image as JobHandler,
  pdf: pdf as JobHandler,
  ai: ai as JobHandler,
};

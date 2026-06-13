// ============================================================
// Trace Writer - JSONL 持久化
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import type { TraceRecord } from '../types.js';

export class TraceWriter {
  private traceDir: string;
  private maxFileSize: number;
  private currentFile: string | null = null;
  private currentSize: number = 0;
  private writeQueue: TraceRecord[] = [];
  private flushing = false;

  constructor(traceDir: string, maxFileSize: number) {
    this.traceDir = traceDir;
    this.maxFileSize = maxFileSize;
    this.ensureDir();
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.traceDir)) {
      fs.mkdirSync(this.traceDir, { recursive: true });
    }
  }

  private getCurrentFile(): string {
    if (!this.currentFile || this.currentSize > this.maxFileSize) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      this.currentFile = path.join(this.traceDir, `traces-${timestamp}.jsonl`);
      this.currentSize = 0;
    }
    return this.currentFile;
  }

  /** Write a trace record to JSONL file (async, non-blocking) */
  write(trace: TraceRecord): void {
    this.writeQueue.push(trace);
    this.flush();
  }

  private flush(): void {
    if (this.flushing || this.writeQueue.length === 0) return;
    this.flushing = true;

    const batch = this.writeQueue.splice(0, this.writeQueue.length);
    const file = this.getCurrentFile();
    const lines = batch.map((t) => JSON.stringify(t)).join('\n') + '\n';
    const size = Buffer.byteLength(lines, 'utf-8');

    fs.appendFile(file, lines, (err) => {
      if (err) {
        console.error('Failed to write trace:', err);
        // Re-queue the failed batch
        this.writeQueue.unshift(...batch);
      } else {
        this.currentSize += size;
      }
      this.flushing = false;

      // If more items queued, flush again
      if (this.writeQueue.length > 0) {
        this.flush();
      }
    });
  }

  /** Get list of trace files */
  getTraceFiles(): string[] {
    this.ensureDir();
    return fs.readdirSync(this.traceDir)
      .filter((f) => f.endsWith('.jsonl'))
      .sort()
      .map((f) => path.join(this.traceDir, f));
  }

  /** Read traces from file(s) */
  readTracesFromFile(file: string, limit?: number): TraceRecord[] {
    if (!fs.existsSync(file)) return [];
    const content = fs.readFileSync(file, 'utf-8');
    const lines = content.trim().split('\n');
    const traces = lines
      .filter((l) => l.trim())
      .flatMap((l) => {
        try { return [JSON.parse(l) as TraceRecord]; }
        catch { return []; }  // skip malformed lines
      });

    if (limit) return traces.slice(-limit);
    return traces;
  }

  /** Delete a single trace file */
  deleteFile(filePath: string): void {
    try { fs.unlinkSync(filePath); } catch {}
    if (this.currentFile === filePath) {
      this.currentFile = null;
      this.currentSize = 0;
    }
  }

  /** Delete all trace files (permanent clear) */
  deleteAllFiles(): void {
    const files = this.getTraceFiles();
    for (const file of files) {
      try { fs.unlinkSync(file); } catch {}
    }
    // Reset current file pointer so next write starts fresh
    this.currentFile = null;
    this.currentSize = 0;
  }

  /** Clean up old trace files beyond maxAge */
  cleanup(maxAge: number): void {
    const now = Date.now();
    const files = this.getTraceFiles();

    for (const file of files) {
      const stat = fs.statSync(file);
      const age = (now - stat.mtimeMs) / 1000;
      if (age > maxAge) {
        fs.unlinkSync(file);
      }
    }
  }
}

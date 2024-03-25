import { Timestamp, DocumentReference } from "firebase-admin/firestore";

export enum FirebaseTaskStatus {
  Started = "started",
  Succeeded = "succeeded",
  Failed = "failed",
  Aborted = "aborted",
}

export class JobTask {
  service: string;
  command: string;
  input?: Record<string, any>;
  output?: Record<string, any>;
  status?: FirebaseTaskStatus = FirebaseTaskStatus.Started;
  startedAt?: Date;
  completedAt?: Date;

  constructor({
    service,
    command,
    input,
    output,
    status,
    startedAt,
    completedAt,
  }: {
    service: string;
    command: string;
    ref?: DocumentReference;
    input?: Record<string, any>;
    output?: Record<string, any>;
    status?: FirebaseTaskStatus;
    startedAt?: Date;
    completedAt?: Date;
  }) {
    let error: string | null = null;

    if (typeof service !== "string" || service.trim() === "") {
      error = "Invalid input: service must be a non-empty string";
    }
  
    if (typeof command !== "string" || command.trim() === "") {
      error = "Invalid input: command must be a non-empty string";
    }

    this.service = service;
    this.command = command;
    this.input = input || {};
    this.output = output || (error ? { error } : {});
    this.status = status || (error ? FirebaseTaskStatus.Failed : FirebaseTaskStatus.Started);
    this.startedAt = startedAt;
    this.completedAt = completedAt;
  }

  update({
    output,
    status,
    startedAt,
    completedAt,
  }: {
    output?: Record<string, any>;
    status?: FirebaseTaskStatus;
    startedAt?: Date;
    completedAt?: Date;
  }): JobTask {
    this.output = output || this.output;
    this.status = status || this.status;
    this.startedAt = startedAt || this.startedAt;
    this.completedAt = completedAt || this.completedAt;

    return this;
  }

  toFirestore(): Record<string, any> {
    return {
      service: this.service,
      command: this.command,
      input: this.input,
      output: this.output,
      status: this.status,
      startedAt: this.startedAt ? Timestamp.fromDate(this.startedAt) : null,
      completedAt: this.completedAt ? Timestamp.fromDate(this.completedAt) : null,
    };
  }
}

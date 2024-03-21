import { Timestamp, DocumentReference } from "firebase-admin/firestore";

export const FIREBASE_TASK_STATUS_STARTED = "started";
export const FIREBASE_TASK_STATUS_FINISHED = "finished";
export const FIREBASE_TASK_STATUS_FAILED = "failed";
export const FIREBASE_TASK_STATUS_ABORTED = "aborted";

export class FirebaseTask {
  ref: DocumentReference;
  service: string;
  command: string;
  input?: Record<string, any>;
  output?: Record<string, any>;
  status?: string = FIREBASE_TASK_STATUS_STARTED;
  createdAt?: Date;
  updatedAt?: Date;

  constructor({
    ref,
    service,
    command,
    input,
    output,
    status,
    createdAt,
    updatedAt,
  }: {
    ref: DocumentReference;
    service: string;
    command: string;
    input?: Record<string, any>;
    output?: Record<string, any>;
    status?: string;
    createdAt?: Date;
    updatedAt?: Date;
  }) {
    this.ref = ref;
    this.service = service;
    this.command = command;
    this.input = input || {};
    this.output = output || {};
    this.status = status || FIREBASE_TASK_STATUS_STARTED;
    this.createdAt = createdAt || new Date();
    this.updatedAt = updatedAt || new Date();
  }

  update({
    output,
    status,
  }: {
    output?: Record<string, any>;
    status?: string;
  }): FirebaseTask {
    this.output = output || this.output;
    this.status = status || this.status;
    this.updatedAt = new Date();

    return this;
  }

  persist() : Promise<FirebaseFirestore.WriteResult> {
    return this.ref.set(this.toFirestore());
  }

  toFirestore(): Record<string, any> {
    return {
      service: this.service,
      command: this.command,
      input: this.input,
      output: this.output,
      status: this.status,
      createdAt: Timestamp.fromDate(this.createdAt ?? new Date()),
      updatedAt: Timestamp.fromDate(this.updatedAt ?? new Date()),
    };
  }
}

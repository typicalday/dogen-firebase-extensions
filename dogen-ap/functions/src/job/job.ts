
import * as admin from "firebase-admin";
import { Timestamp, DocumentReference } from "firebase-admin/firestore";
import { JobTask } from "./jobTask";

const db = admin.firestore();

export enum JobStatus {
  Started = "started",
  Succeeded = "succeeded",
  Failed = "failed",
}

export class Job {
  ref: DocumentReference;
  abortOnFailure: boolean;
  tasks: JobTask[];
  name: String;
  status: JobStatus;
  createdAt: Date;
  updatedAt: Date;

  constructor({
    ref,
    abortOnFailure,
    tasks,
    name,
    status,
    createdAt,
    updatedAt,
  }: {
    abortOnFailure: boolean;
    name: String;
    tasks: JobTask[];
    ref?: DocumentReference;
    outputMessage?: string;
    status?: JobStatus;
    createdAt?: Date;
    updatedAt?: Date;
  }) {
    this.ref = ref ?? db.collection("dogen_application_jobs").doc();
    this.abortOnFailure = abortOnFailure;
    this.name = name;
    this.tasks = tasks;
    this.status = status || JobStatus.Started;
    this.createdAt = createdAt || new Date();
    this.updatedAt = updatedAt || new Date();
  }

  persist(): Promise<FirebaseFirestore.WriteResult> {
    return this.ref.set(this.toFirestore());
  }

  update({
    status,
    updatedAt,
  }: {
    outputMessage?: string;
    status: JobStatus;
    updatedAt: Date;
  }) {
    this.status = status;
    this.updatedAt = updatedAt;
    return this;
  }

  toFirestore(): Record<string, any> {
    return {
      name: this.name,
      abortOnFailure: this.abortOnFailure,
      status: this.status,
      tasks: this.tasks.map((task) => task.toFirestore()),
      createdAt: Timestamp.fromDate(this.createdAt),
      updatedAt: Timestamp.fromDate(this.updatedAt),
    };
  }
}

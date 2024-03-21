/**
 * Manages batch writes to Firestore.
 */
export class BatchManager {
  /**
   * The Firestore write batch.
   */
  batch: FirebaseFirestore.WriteBatch;
  /**
   * The current size of the batch.
   */
  batchSize: number;

  /**
   * The maximum number of operations per batch.
   */
  limit: number;

  /**
   * Creates a new BatchManager instance.
   * @param {FirebaseFirestore.Firestore} db - The Firestore instance to use.
   */
  constructor(private db: FirebaseFirestore.Firestore, limit: number = 500) {
    this.batch = db.batch();
    this.batchSize = 0;
    this.limit = limit;
  }

  /**
   * Adds a document to the batch.
   * @param {FirebaseFirestore.DocumentReference} docRef - The document
   * reference to add.
   * @param {FirebaseFirestore.DocumentData} data - The data to add to the
   * document.
   */
  async add(
    docRef: FirebaseFirestore.DocumentReference,
    data: FirebaseFirestore.DocumentData
  ) {
    this.batch.set(docRef, data);
    this.batchSize++;

    if (this.batchSize >= this.limit) {
      await this.commit();
    }
  }

  /**
   * Deletes a document.
   * @param {FirebaseFirestore.DocumentReference} docRef - The document
   * reference to delete.
   */
  async delete(docRef: FirebaseFirestore.DocumentReference) {
    this.batch.delete(docRef);
    this.batchSize++;
    if (this.batchSize >= this.limit) {
      await this.commit();
    }
  }

  /**
   * Commits the current batch.
   */
  async commit() {
    if (this.batchSize > 0) {
      await this.batch.commit();
      this.batch = this.db.batch();
      this.batchSize = 0;
    }
  }
}

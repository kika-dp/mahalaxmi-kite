import { Injectable } from '@nestjs/common';
import { formatDocumentNumber, istDateString } from '@kite/shared';
import { EntityManager } from 'typeorm';

/**
 * Concurrency-safe, gap-free document numbering (specification.md §8.5).
 * MUST be called inside the transaction that creates the document: the sequence row stays
 * locked until commit, and a rollback releases the number.
 */
@Injectable()
export class SequenceService {
  async next(manager: EntityManager, prefix: string, series: string): Promise<string> {
    const key = `${prefix}:${series}`.slice(0, 40);
    const rows: { last_value: string }[] = await manager.query(
      `INSERT INTO document_sequences(key, last_value) VALUES ($1, 1)
       ON CONFLICT (key) DO UPDATE SET last_value = document_sequences.last_value + 1, updated_at = now()
       RETURNING last_value`,
      [key],
    );
    return formatDocumentNumber(prefix, series, Number(rows[0].last_value));
  }

  /** Series for non-invoice documents: IST calendar year. */
  currentYearSeries(): string {
    return istDateString().slice(0, 4);
  }
}

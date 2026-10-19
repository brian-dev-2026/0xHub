/**
 * Erase a Durable Object's saved data. All our objects keep their state in a
 * single `kv` table, so dropping it (plus the alarm) empties the object.
 * Unlike `storage.deleteAll()`, this is safe to call from inside `alarm()`.
 */
export async function clearStorage(storage: DurableObjectStorage): Promise<void> {
  storage.sql.exec(`DROP TABLE IF EXISTS kv`);
  await storage.deleteAlarm();
}

-- Translate only the original, unedited bundled Note seed.
UPDATE note
SET title = 'First note', body = 'aidot-mini is running correctly.'
WHERE id = 1 AND title = '첫 메모'
  AND body = 'aidot-mini 가 정상 동작합니다.' AND updated_at IS NULL;

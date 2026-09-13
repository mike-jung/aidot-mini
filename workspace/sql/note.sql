-- note.sql  (auto-generated)
-- My Note
-- 접근 키: 'note:<n>'  (예: 'note:findAll')

-- @name: findAll
SELECT id, title, body, created_at, updated_at FROM note ORDER BY id DESC;

-- @name: findById
SELECT id, title, body, created_at, updated_at FROM note WHERE id = :id;

-- @name: insert
INSERT INTO note (title, body)
VALUES (:title, :body);

-- @name: update
UPDATE note
   SET title = :title, body = :body
 WHERE id = :id;

-- @name: deleteById
DELETE FROM note WHERE id = :id;

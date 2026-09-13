-- @name: clearNotes
DELETE FROM note;
-- @name: clearBooks
DELETE FROM sample_book;
-- @name: clearStudents
DELETE FROM sample_students;
-- @name: clearSequence
DELETE FROM sqlite_sequence WHERE name IN ('note','sample_book');
-- @name: count
SELECT COUNT(*) AS total FROM note;
-- @name: insert
INSERT INTO note(title) VALUES(:title);

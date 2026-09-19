-- @name: findAll
SELECT
    id,
    name,
    price,
    memo,
    image_path AS imagePath
FROM demo_product
ORDER BY id DESC;

-- @name: findPaged
-- 정렬은 Service의 허용 목록으로 붙입니다. 마지막 세미콜론을 생략합니다.
SELECT
    id,
    name,
    price,
    memo,
    image_path AS imagePath
FROM demo_product
WHERE name LIKE :keyword ESCAPE '!'
   OR COALESCE(memo, '') LIKE :keyword ESCAPE '!'

-- @name: findById
SELECT
    id,
    name,
    price,
    memo,
    image_path AS imagePath
FROM demo_product
WHERE id = :id;

-- @name: insert
INSERT INTO demo_product (name, price, memo, image_path)
VALUES (:name, :price, :memo, :imagePath);

-- @name: update
UPDATE demo_product
SET name = :name,
    price = :price,
    memo = :memo,
    image_path = :imagePath
WHERE id = :id;

-- @name: deleteById
DELETE FROM demo_product
WHERE id = :id;

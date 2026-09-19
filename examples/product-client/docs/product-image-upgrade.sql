-- 기존 snack 테이블에 image_path 컬럼이 없을 때 한 번만 실행합니다.
-- mini에서는 006_add_snack_image_path.sql이 자동 적용되므로 이 파일을 실행하지 않습니다.
ALTER TABLE snack ADD COLUMN image_path VARCHAR(255) NULL;

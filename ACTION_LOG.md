# 프로젝트 작업 내역 (Action Log)

이 파일은 프로젝트에서 진행된 주요 작업, 변경 사항 및 행동들을 기록하기 위해 사용됩니다.

## 2026-09-20
- 작업 내역 관리를 위한 `ACTION_LOG.md` 파일 생성
- Supabase 데이터베이스 연동 마이그레이션 (`records`, `category_rules`, `master_categories`, `deleted_signatures` 테이블 구축)
- 기존 localStorage 데이터 관리 방식을 Supabase 실시간 백엔드 연동으로 전환
- 구글 OAuth (Google Login) 기능 구현 (로그인 버튼, 프로필/사용자 이름 표시, 로그아웃 기능 추가)


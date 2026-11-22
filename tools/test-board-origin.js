'use strict';

const { createBoardMemoryRepository } = require('../server/board-memory-repository');
const { createBoardService } = require('../server/board-service');
const { createMockUserContextAdapter } = require('../server/board-user-context-adapter');

let failed = 0;

function assert(name, cond) {
  if (!cond) {
    failed += 1;
    console.error('FAIL', name);
    return;
  }
  console.log('PASS', name);
}

function uid(n) {
  return '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
}

function service(territories) {
  return createBoardService({
    repository: createBoardMemoryRepository(),
    userContext: createMockUserContextAdapter({ territories: territories }),
    operational: true,
  });
}

async function main() {
  const pioneer = uid(1);
  const alien = uid(2);
  const svc = service({ [pioneer]: 'PIONEER', [alien]: 'ALIEN' });

  const central = await svc.createPost({ userId: pioneer }, {
    title: '광장 글',
    content: '중앙 게시판에서 등록',
    boardTerritory: 'COMMON',
  });
  assert('중앙 화면 글은 작성자 영토가 아니라 중앙으로 저장', central.post.territory === 'CENTRAL');

  const own = await svc.createPost({ userId: pioneer }, {
    title: '진보 글',
    content: '진보 게시판에서 등록',
    boardTerritory: 'PROGRESSIVE',
  });
  assert('자기 영토 게시판은 그 영토로 저장', own.post.territory === 'PIONEER');

  const omitted = await svc.createPost({ userId: pioneer }, {
    title: '경로 없음',
    content: '기존 작성 경로',
  });
  assert('게시판 경로가 없으면 서버의 작성자 영토를 사용', omitted.post.territory === 'PIONEER');

  let forbidden = null;
  try {
    await svc.createPost({ userId: pioneer }, {
      title: '다른 영토',
      content: '클라이언트가 보낸 보수',
      boardTerritory: 'GUARDIAN',
    });
  } catch (err) {
    forbidden = err;
  }
  assert('권한 없는 영토 값은 거부', forbidden && forbidden.code === 'BOARD_FORBIDDEN');

  let alienCentral = null;
  try {
    await svc.createPost({ userId: alien }, {
      title: '외계에서 지구',
      content: '거부되어야 함',
      boardTerritory: 'CENTRAL',
    });
  } catch (err) {
    alienCentral = err;
  }
  assert('외계 회원의 지구 게시판 값은 저장하지 않음', alienCentral && alienCentral.code === 'BOARD_FORBIDDEN');

  const edited = await svc.updatePost({ userId: pioneer }, central.post.id, {
    title: '수정된 제목',
    content: '본문 수정',
    territory: 'GUARDIAN',
    boardTerritory: 'CONSERVATIVE',
  });
  assert('수정은 원본 영토를 바꾸지 않음', edited.territory === 'CENTRAL' && edited.title === '수정된 제목');

  const alienPost = await svc.createPost({ userId: alien }, {
    title: '외계 원본',
    content: '외계 게시판에 직접 등록',
    boardTerritory: 'KANTAPBIYA',
  });
  assert('외계에 직접 등록한 글은 외계 원본', alienPost.post.territory === 'ALIEN');

  if (failed) process.exit(1);
}

main().catch(function (err) {
  console.error('FAIL', err && err.stack || err);
  process.exit(1);
});

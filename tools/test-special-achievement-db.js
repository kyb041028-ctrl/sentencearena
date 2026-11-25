'use strict';

// Runs against an isolated embedded PostgreSQL, never a configured/live database.
// Install @electric-sql/pglite outside the repo and pass its module path as argv[2].
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { PGlite } = require(process.argv[2] ? path.resolve(process.argv[2]) : '@electric-sql/pglite');
const special = require('../server/special-achievement-service');
const { createUsAchievementService } = require('../server/us-achievement-service');
const uid = n => '00000000-0000-4000-8000-' + String(n).padStart(12,'0');

(async () => {
  const db = new PGlite();
  const query = (sql, args) => db.query(sql, args);
  const options = { query };
  let checks = 0;
  function ok(value) { assert.ok(value); checks++; }
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TABLE public.user_achievements(user_id uuid, achievement_key text, acquired_at timestamptz,
        acquisition_sequence bigint, season_key text, metadata jsonb);
      CREATE UNIQUE INDEX once_achievement ON public.user_achievements(user_id,achievement_key) WHERE season_key IS NULL;
      CREATE TABLE public.user_activity_region_achievement(user_id uuid NOT NULL, activity_region text NOT NULL,
        achievement_key text NOT NULL, acquired_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(user_id,activity_region,achievement_key));`);
    await query("INSERT INTO public.user_activity_region_achievement VALUES($1,'US','first-post','2026-01-01T00:00:00Z')",[uid(50)]);
    const sql = file => fs.readFileSync(path.join(__dirname,'../supabase',file),'utf8');
    await db.exec(sql('migration_grant_user_achievement_canonical.sql'));
    await db.exec(sql('migration_special_achievements_candidate.sql'));
    await db.exec(sql('migration_special_achievements_candidate.sql'));
    const legacy=await query('SELECT * FROM public.user_activity_region_achievement WHERE user_id=$1',[uid(50)]);
    ok(legacy.rows[0].acquisition_notified_at.toISOString()==='2026-01-01T00:00:00.000Z');
    ok((await special.grantBetaParticipation(uid(1),'KR','POST','p1',options)).status === 'BETA_WINDOW_INACTIVE');
    for (const action of ['LOGIN_ONLY','SIGNUP_ONLY','LIKE','DISLIKE','EMPATHY','VIEW_ONLY']) {
      ok((await special.grantBetaParticipation(uid(1),'KR',action,'x',options)).status === 'BETA_PARTICIPATION_INVALID');
    }
    await db.exec("INSERT INTO public.achievement_beta_windows VALUES('KR',now()-interval '1 hour',now()+interval '1 hour')");
    const first = await special.grantBetaParticipation(uid(1),'KR','POST','p1',options);
    ok(first.status === 'GRANTED' && first.achievement_key === 'beta-citizen');
    ok((await special.grantBetaParticipation(uid(1),'KR','ISSUE_COMMENT','c2',options)).status === 'ALREADY_GRANTED');
    ok((await special.grantBetaParticipation(uid(2),'US','BOARD_COMMENT','c1',options)).status === 'BETA_WINDOW_INACTIVE');
    await db.exec("INSERT INTO public.achievement_beta_windows VALUES('US',now()-interval '1 hour',now()+interval '1 hour')");
    for (const [n,action] of [[2,'POST'],[3,'BOARD_COMMENT'],[4,'ISSUE_COMMENT']]) {
      ok((await special.grantBetaParticipation(uid(n),'US',action,'source-'+n,options)).status === 'GRANTED');
    }
    ok((await query('SELECT * FROM public.user_achievements WHERE user_id=$1',[uid(2)])).rows.length === 0);
    await db.exec("UPDATE public.achievement_beta_windows SET starts_at=now()+interval '1 hour', ends_at=now()+interval '2 hours' WHERE activity_region='US'");
    ok((await special.grantBetaParticipation(uid(5),'US','POST','future',options)).status === 'BETA_WINDOW_INACTIVE');
    await db.exec("UPDATE public.achievement_beta_windows SET starts_at=now()-interval '2 hours', ends_at=now() WHERE activity_region='US'");
    ok((await special.grantBetaParticipation(uid(5),'US','POST','ended',options)).status === 'BETA_WINDOW_INACTIVE');
    await assert.rejects(db.exec("INSERT INTO public.achievement_beta_windows VALUES('XX',now(),now())")); checks++;
    const bug = (n,region,key,inquiry=n) => ({ inquiryId:uid(100+inquiry),userId:uid(n),region,bugKey:key,ownerId:uid(900),evidence:'Reproduced twice; attached server trace confirms the failure.' });
    ok((await special.acceptVerifiedBug(bug(6,'KR','board-save-001'),options)).status === 'GRANTED');
    ok((await special.acceptVerifiedBug(bug(7,'US','board-save-001'),options)).status === 'DUPLICATE_BUG');
    ok((await special.acceptVerifiedBug(bug(7,'US','different-key',6),options)).status === 'DUPLICATE_BUG');
    ok((await special.acceptVerifiedBug(bug(6,'US','another-real-bug'),options)).status === 'ALREADY_GRANTED');
    ok((await special.acceptVerifiedBug(bug(7,'US','us-bug-002'),options)).status === 'GRANTED');
    await assert.rejects(special.acceptVerifiedBug({...bug(8,'KR','bad-evidence'),evidence:'yes'},options)); checks++;
    const repeated = await Promise.all(Array.from({length:5},()=>special.acceptVerifiedBug(bug(8,'US','retry-003'),options)));
    ok(repeated.filter(r=>r.status==='GRANTED').length===1);
    // Failed downstream grant must roll back the acceptance receipt, allowing safe retry.
    await db.exec(`CREATE FUNCTION fail_test_grant() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.user_id='${uid(9)}' THEN RAISE EXCEPTION 'test grant failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER fail_test_grant BEFORE INSERT ON public.user_achievements FOR EACH ROW EXECUTE FUNCTION fail_test_grant();`);
    await assert.rejects(special.acceptVerifiedBug(bug(9,'KR','rollback-004'),options)); checks++;
    ok((await query('SELECT * FROM public.achievement_verified_bugs WHERE reporter_user_id=$1',[uid(9)])).rows.length===0);
    const us = createUsAchievementService(options);
    const bundle = await us.bundle(uid(7));
    ok(bundle.currentAchievements.length===1 && bundle.currentAchievements[0].achievementId==='bug-busters');
    const record = bundle.currentAchievements[0];
    ok(record.acquisitionSequence>0 && record.acquiredAt && record.acquisitionNotifiedAt===null);
    await db.exec(sql('migration_special_achievements_candidate.sql'));
    ok((await us.bundle(uid(7))).currentAchievements[0].acquisitionNotifiedAt===null);
    await us.featured(uid(7),['bug-busters']);
    ok((await us.bundle(uid(7))).featuredAchievementIds[0]==='bug-busters');
    await assert.rejects(us.featured(uid(7),['first-post'])); checks++;
    await assert.rejects(us.featured(uid(7),['bug-busters','bug-busters'])); checks++;
    await assert.rejects(us.notified(uid(8),{achievementId:'bug-busters',acquisitionSequence:record.acquisitionSequence})); checks++;
    await us.notified(uid(7),{achievementId:'bug-busters',acquisitionSequence:record.acquisitionSequence});
    ok(!!(await us.bundle(uid(7))).currentAchievements[0].acquisitionNotifiedAt);
    ok((await us.bundle(uid(7))).currentAchievements[0].acquiredAt===record.acquiredAt);
    // Exercise the actual US score repository and its participation hook using SQL.
    await db.exec(`CREATE FUNCTION public.activity_region_norm(text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT coalesce($1,'KR') $$;
      CREATE TABLE public.user_activity_region_profile(user_id uuid,activity_region text,level int DEFAULT 1,
        xp int DEFAULT 0,reputation_score int DEFAULT 0,aura int DEFAULT 0,tendency text,evolution_contribution int DEFAULT 0,
        territory text,updated_at timestamptz,PRIMARY KEY(user_id,activity_region));
      CREATE TABLE public.board_posts(id text,author_user_id uuid,status text,activity_region text);
      CREATE TABLE public.board_comments(id text,post_id text,author_user_id uuid,status text,activity_region text);
      CREATE TABLE public.user_activity_events(id bigserial,user_id uuid,activity_type text,payload jsonb,dedupe_key text UNIQUE,activity_region text);
      CREATE TABLE public.user_notifications(user_id uuid,notification_type text,title text,message text,activity_region text);
      UPDATE public.achievement_beta_windows SET starts_at=now()-interval '1 hour',ends_at=now()+interval '1 hour' WHERE activity_region='US';`);
    await query("INSERT INTO public.board_posts VALUES('us-post-11',$1,'ACTIVE','US')",[uid(11)]);
    const scores=require('../server/activity-region-score-repository').createActivityRegionScoreRepository(options);
    const scored=await scores.applyEvent({region:'US',userId:uid(11),eventType:'POST_CREATED',sourceId:'us-post-11'});
    ok(scored.achievementsGranted.some(g=>g.record.achievementId==='first-post' && g.record.acquisitionSequence>0));
    ok(scored.achievementsGranted.some(g=>g.record.achievementId==='beta-citizen'));
    ok((await query('SELECT * FROM public.user_achievements WHERE user_id=$1',[uid(11)])).rows.length===0);
    await scores.applyEvent({region:'US',userId:uid(11),eventType:'POST_CREATED',sourceId:'us-post-11'});
    ok((await us.bundle(uid(11))).currentAchievements.length===2);
    const issueScore=await scores.applyEvent({region:'US',userId:uid(12),eventType:'BOARD_COMMENT_CREATED',sourceId:'daily-issue-comment:12'});
    ok(issueScore.achievementsGranted.length===1 && issueScore.achievementsGranted[0].record.achievementId==='beta-citizen');
    for (const role of ['anon','authenticated']) {
      await db.exec('SET ROLE '+role);
      await assert.rejects(query('SELECT public.grant_beta_participation($1, $2, $3, $4)',[uid(10),'KR','POST','fake'])); checks++;
      await assert.rejects(query('SELECT public.accept_verified_bug_achievement($1,$2,$3,$4,$5,$6)',[uid(100),'00000000-0000-4000-8000-000000000010','KR','fake-bug',uid(900),'fake evidence'])); checks++;
      await assert.rejects(query('SELECT * FROM public.achievement_verified_bugs')); checks++;
      await db.exec('RESET ROLE');
    }
    console.log('PASS special achievement PostgreSQL:',checks,'checks (isolated PGlite; no external DB)');
  } finally { await db.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});

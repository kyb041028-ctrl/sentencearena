/**
 * 로그인·가입 안내 문구. 화면 언어만 고른다. 인증 요청은 바꾸지 않는다.
 * /us 는 영어, /kr 은 한국어. 서버가 준 문장은 그대로 찍지 않고 오류 코드로 고른다.
 */
(function (global) {
  'use strict';

  var COPY = {
    LEAD: { KR: '의견의 세계에 입장하세요.', US: 'Enter the arena.' },
    CHOOSE_LOGIN: { KR: '로그인할 계정을 선택하세요.', US: 'Choose an account to log in.' },
    CHOOSE_SIGNUP: { KR: '가입할 계정을 선택하세요.', US: 'Choose an account to sign up.' },
    NO_ACCOUNT: { KR: '가입된 계정이 없습니다.', US: 'No account was found.' },
    PLEASE_SIGNUP: { KR: '회원가입을 진행해주세요.', US: 'Please sign up.' },
    LOGIN_START_FAILED: { KR: '로그인을 시작하지 못했습니다.', US: 'The login could not be started.' },
    SESSION_CHECK_FAILED: { KR: '로그인 정보를 확인하지 못했습니다.', US: 'We could not check the login session.' },
    RETRY: { KR: '다시 시도', US: 'Try again' },
    SOCIAL_LOGIN: { KR: '소셜 로그인', US: 'Social login' },
    INVALID_EMAIL: { KR: '이메일 형식이 올바르지 않습니다.', US: 'That email address is not valid.' },
    MISSING_FIELDS: { KR: '필수 항목을 입력해 주세요.', US: 'Fill in the required fields.' },
    INVALID_PASSWORD: { KR: '비밀번호가 올바르지 않습니다.', US: 'That password is not correct.' },
    WEAK_PASSWORD: { KR: '비밀번호는 6자 이상이어야 합니다.', US: 'Use a password of at least 6 characters.' },
    USER_NOT_FOUND: { KR: '가입된 계정을 찾지 못했습니다.', US: 'No account was found for that sign-in.' },
    SIGNIN_FAILED: { KR: '로그인에 실패했습니다.', US: 'Login failed.' },
    SIGNUP_FAILED: { KR: '가입에 실패했습니다.', US: 'Sign-up failed.' },
    ALREADY_REGISTERED: { KR: '이미 가입한 계정입니다. 로그인해 주세요.', US: 'This account is already registered. Log in instead.' },
    EMAIL_NOT_CONFIRMED: { KR: '이메일 인증이 끝나지 않았습니다. 메일을 확인해 주세요.', US: 'Email verification is not finished. Check your inbox.' },
    EMAIL_VERIFY_FAILED: { KR: '이메일 인증에 실패했습니다.', US: 'Email verification failed.' },
    OTP_EXPIRED: { KR: '인증번호가 만료되었습니다. 다시 요청해 주세요.', US: 'That verification code has expired. Request a new one.' },
    OTP_INVALID: { KR: '인증번호가 올바르지 않습니다.', US: 'That verification code is not valid.' },
    OAUTH_CANCELLED: { KR: '소셜 로그인을 취소했습니다.', US: 'The social login was canceled.' },
    SOCIAL_AUTH_FAILED: { KR: '소셜 인증에 실패했습니다.', US: 'Social sign-in failed.' },
    CALLBACK_FAILED: { KR: '로그인을 끝내지 못했습니다.', US: 'Login could not be finished.' },
    CALLBACK_WORKING: { KR: '로그인 처리 중…', US: 'Finishing sign-in…' },
    CALLBACK_HOME: { KR: '처음으로', US: 'Back to the start' },
    AUTH_MODULE_MISSING: { KR: '인증 모듈을 불러오지 못했습니다.', US: 'The sign-in module did not load.' },
    OAUTH_BRIDGE_WAIT: { KR: '소셜 로그인으로 이동하는 중…', US: 'Opening the social login…' },
    OAUTH_BRIDGE_PARAMS: { KR: '로그인 시작 정보가 없습니다.', US: 'The login start details are missing.' },
    OAUTH_BRIDGE_FAILED: { KR: '로그인 시작에 실패했습니다.', US: 'The login could not be started.' },
    SESSION_EXPIRED: { KR: '세션이 만료되었습니다. 다시 로그인해 주세요.', US: 'Your session expired. Log in again.' },
    LOGIN_REQUIRED: { KR: '로그인한 회원만 이용할 수 있습니다.', US: 'Sign in to continue.' },
    NETWORK_ERROR: { KR: '네트워크 연결을 확인한 뒤 다시 시도해 주세요.', US: 'Check the connection and try again.' },
    SERVER_ERROR: { KR: '서버 오류로 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.', US: 'The server could not complete this. Try again shortly.' },
    FORBIDDEN: { KR: '이 작업을 할 권한이 없습니다.', US: 'You do not have permission to do this.' },
    INVALID_NICKNAME: { KR: '활동명은 2자 이상이어야 합니다.', US: 'Use a name of at least 2 characters.' },
    AGE_TITLE: { KR: '연령 확인', US: 'Age check' },
    AGE_NOTICE: { KR: 'SentenceArena는 만 14세 이상만 가입할 수 있습니다.', US: 'United States sign-up is for people 18 or older. The date of birth itself is not stored.' },
    YEAR: { KR: '년', US: 'Year' },
    MONTH: { KR: '월', US: 'Month' },
    DAY: { KR: '일', US: 'Day' },
    CANCEL: { KR: '취소', US: 'Cancel' },
    NEXT: { KR: '다음', US: 'Next' },
    AGREE_CONTINUE: { KR: '동의하고 계속', US: 'Agree and continue' },
    AGE_UNDER_18: { KR: '만 18세 미만은 미국 가입을 할 수 없습니다.', US: 'You must be 18 or older to join from the United States.' },
    AGE_UNDER_14: { KR: '만 14세 미만은 가입할 수 없습니다.', US: 'You must be 14 or older to join.' },
    AGE_FUTURE: { KR: '미래 날짜는 입력할 수 없습니다.', US: 'A future date cannot be used.' },
    AGE_POLICY: { KR: '연령 정책을 확인하지 못했습니다.', US: 'The age policy could not be checked.' },
    AGE_INVALID: { KR: '올바른 생년월일을 입력해 주세요.', US: 'Enter a valid date of birth.' },
    AGE_SAVE_FAILED: { KR: '연령 확인을 저장하지 못했습니다.', US: 'The age check could not be saved.' },
    CONSENT_SAVE_FAILED: { KR: '동의를 저장하지 못했습니다.', US: 'Consent could not be saved.' },
    LEGAL_TITLE: {
      KR: '[필수] 정치 관련 정보 처리 및 소속 영토 공개에 동의합니다.',
      US: '[Required] I agree to processing of political information and to showing my territory.',
    },
    LEGAL_NOTICE: {
      KR: 'SentenceArena는 이용자의 서비스 내 활동을 바탕으로 정치적 성향 관련 정보를 처리하며, 그 결과에 따라 현재 소속 영토가 결정될 수 있습니다. 현재 소속 영토는 다른 이용자에게 공개됩니다. 정치성향 원점수, 세부 계산내역, 변화량 및 과거 이동 세부기록은 다른 이용자에게 공개되지 않습니다.',
      US: 'SentenceArena uses activity in the service to process information related to political tendency, and that result can decide the current territory. The current territory is visible to other members. Raw tendency scores, the calculation detail, the amount of change, and the detailed history of past moves are not shown to other members.',
    },
    LEGAL_H_ITEMS: { KR: '처리하는 정치 관련 정보', US: 'Political information that is processed' },
    LEGAL_H_PURPOSES: { KR: '이용 목적', US: 'Why it is used' },
    LEGAL_H_RETENTION: { KR: '보유 기간', US: 'How long it is kept' },
    LEGAL_RETENTION: { KR: '민감정보 동의 철회 또는 회원탈퇴 시까지', US: 'Until consent is withdrawn or the account is deleted.' },
    LEGAL_REFUSAL: { KR: '이에 동의하지 않을 경우 회원가입 및 회원 기능을 이용할 수 없습니다.', US: 'Without this agreement, sign-up and member features are not available.' },
    LEGAL_CHECK: { KR: '위 내용에 동의합니다.', US: 'I agree to the above.' },
    LEGAL_DRAFT: { KR: '검토용 초안입니다. 법률 검토 완료가 아닙니다.', US: 'This is a draft for review. It is not a completed legal review.' },
    LEGAL_TERMS_LINK: { KR: '이용약관 초안 전문', US: 'Full draft terms' },
    LEGAL_TERMS_VIEWED: { KR: '이용약관 초안 전문을 확인했습니다', US: 'I have opened the full draft terms' },
    LEGAL_TERMS_ACK: { KR: '이용약관 초안에 동의합니다', US: 'I agree to the draft terms' },
    LEGAL_PRIVACY_LINK: { KR: '개인정보처리방침 초안 전문', US: 'Full draft privacy policy' },
    LEGAL_PRIVACY_VIEWED: { KR: '개인정보처리방침 전문을 확인했습니다', US: 'I have opened the full privacy policy' },
    LEGAL_NOT_BLANKET: { KR: '이 확인은 모든 개인정보 처리에 대한 일괄 동의가 아닙니다.', US: 'This check is not a blanket agreement to every kind of personal-data processing.' },
    LEGAL_MARKETING: { KR: '선택: 마케팅 수신에 동의합니다. 동의하지 않아도 가입할 수 있습니다.', US: 'Optional: I agree to marketing messages. Sign-up does not require this.' },
    LOCAL_BETA_TITLE: { KR: '로컬 시험 로그인', US: 'Local test login' },
    UNKNOWN: { KR: '요청을 처리하지 못했습니다. 다시 시도해 주세요.', US: 'Something went wrong. Please try again.' },
  };

  var ALIAS = {
    invalid_email: 'INVALID_EMAIL',
    email_address_invalid: 'INVALID_EMAIL',
    invalid_credentials: 'INVALID_PASSWORD',
    invalid_password: 'INVALID_PASSWORD',
    weak_password: 'WEAK_PASSWORD',
    user_not_found: 'USER_NOT_FOUND',
    email_not_confirmed: 'EMAIL_NOT_CONFIRMED',
    email_not_verified: 'EMAIL_VERIFY_FAILED',
    user_already_exists: 'ALREADY_REGISTERED',
    email_exists: 'ALREADY_REGISTERED',
    already_member: 'ALREADY_REGISTERED',
    signup_disabled: 'SIGNUP_FAILED',
    signin_failed: 'SIGNIN_FAILED',
    signup_failed: 'SIGNUP_FAILED',
    access_denied: 'OAUTH_CANCELLED',
    user_cancelled: 'OAUTH_CANCELLED',
    otp_expired: 'OTP_EXPIRED',
    flow_state_expired: 'OTP_EXPIRED',
    otp_disabled: 'OTP_INVALID',
    invalid_grant: 'SOCIAL_AUTH_FAILED',
    oauth_failed: 'SOCIAL_AUTH_FAILED',
    server_error: 'SERVER_ERROR',
    unexpected_failure: 'SERVER_ERROR',
    network_error: 'NETWORK_ERROR',
    forbidden: 'FORBIDDEN',
    unauthorized: 'FORBIDDEN',
    permission_denied: 'FORBIDDEN',
    missing_fields: 'MISSING_FIELDS',
    local_login_required: 'MISSING_FIELDS',
    local_signup_required: 'MISSING_FIELDS',
    local_login_failed: 'SIGNIN_FAILED',
    local_login_unavailable: 'SERVER_ERROR',
    display_name_invalid: 'INVALID_NICKNAME',
    invalid_nickname: 'INVALID_NICKNAME',
    age_under_18: 'AGE_UNDER_18',
    age_under_14: 'AGE_UNDER_14',
    age_future: 'AGE_FUTURE',
    age_policy_version_mismatch: 'AGE_POLICY',
    region_mismatch: 'AGE_POLICY',
    age_invalid: 'AGE_INVALID',
    session_expired: 'SESSION_EXPIRED',
    no_auth_code: 'CALLBACK_FAILED',
  };

  function pathRegion() {
    var path = global.location && global.location.pathname ? String(global.location.pathname) : '';
    if (path === '/us' || path.indexOf('/us/') === 0) return 'US';
    if (path === '/kr' || path.indexOf('/kr/') === 0) return 'KR';
    return '';
  }

  function remember(next) {
    try {
      global.localStorage.setItem('sa_auth_copy_region', next);
    } catch (_) {}
  }

  function region() {
    var fromPath = pathRegion();
    if (fromPath) {
      remember(fromPath);
      return fromPath;
    }
    try {
      var saved = global.localStorage.getItem('sa_auth_copy_region');
      if (saved === 'US' || saved === 'KR') return saved;
    } catch (_) {}
    return 'KR';
  }

  function text(code, forced) {
    var lang = forced === 'US' || forced === 'KR' ? forced : region() === 'US' ? 'US' : 'KR';
    var row = COPY[code] || COPY.UNKNOWN;
    return row[lang];
  }

  function fromError(error, forced) {
    var raw = '';
    if (error && typeof error === 'object') {
      raw = error.code || error.error || error.error_code || '';
    } else {
      raw = error || '';
    }
    raw = String(raw).trim();
    var key = ALIAS[raw] || ALIAS[raw.toLowerCase()] || '';
    if (!key && COPY[raw]) key = raw;
    if (!key) key = 'UNKNOWN';
    return text(key, forced);
  }

  global.ScAuthCopy = {
    text: text,
    fromError: fromError,
    region: region,
  };
})(typeof window !== 'undefined' ? window : this);

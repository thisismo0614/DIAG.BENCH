// src/i18n/rules/en-crossref.js
// 상관관계 단계가 이슈에 덧붙이는 근거 줄(영어).
//
// 키는 **두 이슈의 메시지 id 쌍**이다 — `A>B`. rules.js의 crossReference(A, B, …)가
// 그 쌍을 이슈에 남겨두고, reportI18n.js가 여기서 문장을 찾는다.
// `a`는 앞 이슈(A)에 붙는 줄, `b`는 뒤 이슈(B)에 붙는 줄이다.
//
// 왜 이렇게 하는가 — 이 근거는 **이슈가 만들어진 뒤에** 붙는다. 카탈로그의 근거 개수와
// 대조하면 어긋나서, 멀쩡한 이슈가 통째로 한국어로 떨어진다(실제로 그렇게 됐던 것을
// 테스트가 잡았다). 호출부 16곳을 건드리지 않고 쌍으로 찾아가게 한 이유이기도 하다.
//
// ⚠ 새 상관관계를 추가하면 여기에도 항목을 넣어야 한다. 넣지 않으면 그 이슈는 영어에서
//    원문(한국어)으로 남는다 — 조용히 반쪽짜리 영어가 되는 것보다 낫다.

module.exports = {
  // CPU 과열 ↔ 예기치 않은 종료
  'CPU-THERMAL-THROTTLING>EVENT-KERNEL-POWER': {
    a: 'Unexpected shutdown/restart events were recorded recently, so this may have led to a protective shutdown from overheating',
    b: 'CPU thermal throttling was also confirmed in today\'s diagnosis, so a protective shutdown from overheating is likely',
  },

  // GPU 과열 ↔ 그래픽 드라이버 TDR
  'GPU-THERMAL-THROTTLING>EVENT-DISPLAY-TDR': {
    a: 'Graphics driver timeout (TDR) events were recorded recently, so this may be the same cooling problem',
    b: 'GPU thermal throttling was also confirmed in today\'s diagnosis, so overheating may have been the cause',
  },

  // RAM 검사 불일치 ↔ WHEA / 블루스크린
  'RAM-TEST-MISMATCH>EVENT-WHEA': {
    a: 'Hardware error (WHEA) events were also confirmed recently, which makes a memory hardware fault likely',
    b: 'The RAM integrity test also found mismatches, which makes a memory-related hardware error likely',
  },
  'RAM-TEST-MISMATCH>EVENT-BUGCHECK': {
    a: 'Blue screen records were also confirmed recently, so the memory errors may have led to system crashes',
    b: 'The RAM integrity test found mismatches, so a memory problem may have been the cause',
  },

  // SMART 대기 중 섹터 / CRC / 저장장치 검사 ↔ 디스크·파일시스템 오류 이벤트
  'SMART-PENDING-SECTORS>EVENT-DISK-NTFS': {
    a: 'Disk errors are recorded in the Windows event log too, which makes actual read failures likely',
    b: 'SMART shows sectors that failed to read, which makes a fault in the drive itself likely',
  },
  'SMART-CRC-ERRORS>EVENT-DISK-NTFS': {
    a: 'The Windows event log also shows disk errors, so the transfer problem may be causing real I/O failures — reason to try replacing the cable first',
    b: 'SMART also records transfer errors (CRC), so it is worth checking the cable and connection before assuming the drive has failed',
  },
  'STORAGE-TEST-VERIFY-MISMATCH>EVENT-DISK-NTFS': {
    a: 'Storage/file system error events were also confirmed recently, which makes a device fault likely',
    b: 'The storage test also found a data mismatch, which makes an ongoing problem likely',
  },

  // CPU 부하 테스트 안전 한계 중단 ↔ 예기치 않은 종료
  'CPU-STRESS-SAFETY-ABORT>EVENT-KERNEL-POWER': {
    a: 'Unexpected shutdown/restart events were also recorded, so a protective shutdown from overheating is possible',
    b: 'The CPU reached the safety temperature limit during the stress test, so a protective shutdown from overheating is possible',
  },

  // WHEA ↔ 메모리 이슈 (ramBad는 메모리 계열 경고 아무거나)
  'EVENT-WHEA>MEM-USAGE-NEAR-LIMIT': {
    a: 'A memory-related issue was also confirmed, so this may be a memory hardware error',
    b: 'Hardware error (WHEA) events were also confirmed recently, so this may be a memory-related hardware problem',
  },

  // GPU 부하 테스트 스로틀링 ↔ TDR / 예기치 않은 종료
  'GPU-STRESS-THROTTLE>EVENT-DISPLAY-TDR': {
    a: 'Graphics driver timeout (TDR) events were also confirmed recently, so the overheating may have produced real symptoms',
    b: 'GPU thermal throttling was confirmed in the stress test, so overheating may have been the cause',
  },
  'GPU-STRESS-THROTTLE>EVENT-KERNEL-POWER': {
    a: 'Unexpected shutdown/restart events were also recorded, so this may have led to a protective shutdown from overheating',
    b: 'GPU thermal throttling was confirmed in the stress test, so a protective shutdown from overheating is possible',
  },

  // VRAM 불일치 ↔ TDR / WHEA
  'VRAM-MISMATCH>EVENT-DISPLAY-TDR': {
    a: 'Graphics driver timeout (TDR) events were also confirmed recently, so this may be a graphics memory problem',
    b: 'The VRAM integrity check also found mismatches, so the cause may lie in graphics memory rather than the driver',
  },
  'VRAM-MISMATCH>EVENT-WHEA': {
    a: 'Hardware error (WHEA) events were also confirmed recently, so this may not be a transient error',
    b: 'A VRAM integrity mismatch was also confirmed, so this may be a graphics-memory-related hardware error',
  },

  // VRAM 컨텍스트 손실 ↔ TDR
  'VRAM-CONTEXT-LOST>EVENT-DISPLAY-TDR': {
    a: 'Graphics driver timeout (TDR) events are recorded, so the loss during the test may be the same problem reproducing',
    b: 'Context loss also reproduced during the VRAM test, so this may not be a one-off event',
  },

  // 디스크 이벤트 ↔ 오늘의 저장장치 이상 (storageBad는 저장장치 계열 이슈 아무거나)
  'EVENT-DISK-NTFS>SMART-PENDING-SECTORS': {
    a: 'The storage diagnosis also found a problem, which makes the same drive fault likely',
    b: 'Storage/file system error events were also confirmed recently, which makes an ongoing problem likely',
  },
  'EVENT-DISK-NTFS>STORAGE-TEST-VERIFY-MISMATCH': {
    a: 'The storage diagnosis also found a problem, which makes the same drive fault likely',
    b: 'Storage/file system error events were also confirmed recently, which makes an ongoing problem likely',
  },
  'EVENT-DISK-NTFS>SMART-HEALTH-FAILED': {
    a: 'The storage diagnosis also found a problem, which makes the same drive fault likely',
    b: 'Storage/file system error events were also confirmed recently, which makes an ongoing problem likely',
  },

  // 설정 변경 항목이 있을 때 오류 이벤트마다 붙는 줄 (쌍이 아니라 단독)
  'CONFIG-CHANGED-NOTE': {
    a: (p) => `Settings differ from the default (${(p.changedKeys || []).map((k) => ({
      cpuBaseClock: 'CPU base clock',
      gpuPowerLimit: 'GPU power limit',
      memoryProfile: 'memory profile',
    }[k] || k)).join(', ')}), so they need checking alongside this`,
  },
};

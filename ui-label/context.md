# Subagent UI Label Patch Location

목표: \"subagent\"/\"parallel\" 상단 라인 제거 + 박스 제목 \"Subagent\"를 \"Executable\"로 변경

## 1) 상단 라인(\"subagent\", \"parallel\") 출력 소스

- 파일: `vendor/amaze-subagents/src/extension/index.ts`
- 함수: `registerSubagentExtension` 내부
- 지점: ToolDefinition의 `renderCall`
- 현재 코드 스니펫 근거: `const mode = params.tasks ? "parallel" : params.chain ? "chain" : params.agent ? params.agent : "subagent";`
- 그리고 `return new Text(`${mode}${asyncBadge}`, 0, 0);`
- 의미: 도구 호출 라인에 모드/타이틀("subagent", "parallel", 에이전트명)을 상단 텍스트로 렌더링
- **제거 대상**: 이 `renderCall`이 바로 상단 한 줄 라벨의 주된 원인

## 2) 박스 헤더(\"Subagent\") 출력 소스

- 파일: `vendor/amaze-subagents/src/extension/index.ts`
- 함수: ToolDefinition의 `renderResult`
- 현재 코드 스니펫 근거: `new SubagentBoxWrapper(inner, theme, "Subagent")`
- 의미: subagent 결과 박스의 헤더 문자열을 하드코딩
- **변경 대상**: 문자열을 `"Executable"`로 바꾸면 박스 상단 제목 변경됨

- 보조 파일: `vendor/amaze-subagents/src/tui/render.ts`
- 클래스: `SubagentBoxWrapper`
- 메서드: `render(width)`
- 렌더 패턴: `const headerText = ` ${this.header} `;`
- 의미: `renderResult`에서 전달받은 헤더 문자열을 상단 경계선 제목으로 사용

## 3) 라벨(도구 레벨) 텍스트

- 파일: `vendor/amaze-subagents/src/extension/index.ts`
- 지점: ToolDefinition의 `label`
- 현재: `label: "Subagent"`
- 사용처는 도구 목록/식별 UI에 영향 가능성이 있어 변경 시 부작용 점검 필요

## 패치 포인트 요약

1) `vendor/amaze-subagents/src/extension/index.ts`
   - `renderCall`: `mode` 라인 반환 제거 또는 빈 문자열 반환으로 상단 standalone 제목 삭제
   - `renderResult`: `new SubagentBoxWrapper(inner, theme, "Subagent")` → `"Executable"`

2) (필요 시) `vendor/amaze-subagents/src/extension/index.ts`의 `label`도 `Subagent`에서 `Executable`로 바꿀지 검토

3) `vendor/amaze-subagents/src/tui/render.ts`는 전달값만 표시하므로 1)에서 전달 헤더만 바꿔주면 반영됨
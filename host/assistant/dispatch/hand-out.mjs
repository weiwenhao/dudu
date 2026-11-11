// A new issue that dispatch has given to an agent (dispatch.assign) gets its work started (docs/assistant.md 3.3 "分配之后"):
// a fresh session in the issue's folder. An issue dispatch could not give to anyone stays in Todo with its question; nothing is started.
//
//   const handOut = createHandOut({ dispatch, assignment });
//   await handOut(issueId)
//
//   assignment  home/assign.mjs: start(issue, { access })
export function createHandOut({ dispatch, assignment }) {
  return async function handOut(id) {
    const result = await dispatch.assign(id);
    if (!result?.assigned) return result;
    await assignment.start?.(result.issue, { access: result.access });
    return result;
  };
}

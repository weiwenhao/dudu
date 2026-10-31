// A new issue that dispatch has given to an agent (dispatch.assign) gets its work started (docs/assistant.md 3.3 "分配之后"):
// a fresh session in the issue's folder, or, when ASSIGN.md or history offered the session that handled this kind of issue before, that
// session, which is told about the issue. An issue dispatch could not give to anyone stays in Todo with its question; nothing is started.
//
//   const handOut = createHandOut({ dispatch, issues, assignment, firstMessage });
//   await handOut(issueId)
//
//   assignment  home/assign.mjs: start(issue, { access }), restore() (follows the sessions of open issues), onReply(issue, text)
//   firstMessage  home/first-message.mjs (passed in so that this file imports nothing of DSH's side)
export function createHandOut({ dispatch, issues, assignment, firstMessage }) {
  return async function handOut(id) {
    const result = await dispatch.assign(id);
    if (!result?.assigned) return result;
    if (!result.reused) {
      await assignment.start?.(result.issue, { access: result.access });
      return result;
    }
    const got = issues.get(id, { logLimit: 200 });
    if (got.outcome !== 'success') return result;
    await assignment.restore?.(); // the issue has the session now; this makes the plugin follow it
    await assignment.onReply?.(got.issue, firstMessage({ issue: got.issue, log: [...got.log].reverse(), access: result.access, material: null }));
    return result;
  };
}

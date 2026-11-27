// The environment of the process a harness runs in, as the stores of Pi and Antigravity need it to find the folder the harness writes to. OAR starts the harness with its own
// environment (`sessionEnvironment`) and reads it with `environmentValue`; neither is part of its public entry, so the same two rules are here: on Windows the names of environment
// variables ignore case, and an empty value counts as unset.

/** The environment a harness is started with: what this process has, with `overlay` (strings override) on top. On Windows another spelling of an overridden name goes. */
export function mergedEnvironment(overlay = {}, inherited = process.env, platform = process.platform) {
  const environment = { ...inherited };
  for (const [key, value] of Object.entries(overlay ?? {})) {
    if (platform === 'win32') {
      for (const name of Object.keys(environment)) if (name.toUpperCase() === key.toUpperCase()) delete environment[name];
    }
    if (typeof value === 'string') environment[key] = value;
    else delete environment[key];
  }
  return environment;
}

/** The value of `name`, or undefined when it is not set or empty (on Windows whatever the case of its name). */
export function environmentValue(env, name, platform = process.platform) {
  const key = platform === 'win32' ? Object.keys(env).toSorted().find((entry) => entry.toUpperCase() === name.toUpperCase()) ?? name : name;
  const value = env[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

// A promise the test resolves by hand. Anything that asserts on *in-flight*
// state — a pending label, a disabled control, a result landing after the user
// moved on — needs control over when the call settles, not just what it
// returns. The extension's suite carries the same idiom in
// test/helpers/webext.ts.

export interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
}

export function deferred<T> (): Deferred<T> {
  let resolve: (value: T) => void = () => {}
  let reject: (reason: unknown) => void = () => {}
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

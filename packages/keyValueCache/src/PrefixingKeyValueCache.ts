import type { KeyValueCache, KeyValueCacheSetOptions } from ".";

// PrefixingKeyValueCache wraps another cache and adds a prefix to all keys used
// by all operations. This allows multiple features to share the same underlying
// cache without conflicts.
//
// Note that PrefixingKeyValueCache explicitly does not implement methods like
// flush() that aren't part of KeyValueCache, even though most KeyValueCache
// implementations also have a flush() method. Most implementations of flush()
// send a simple command that wipes the entire backend cache system, which
// wouldn't support "only wipe the part of the cache with this prefix", so
// trying to provide a flush() method here could be confusingly dangerous.
export class PrefixingKeyValueCache<V = string> implements KeyValueCache<V> {
  private prefix: string;
  constructor(private wrapped: KeyValueCache<V>, prefix: string) {
    if (prefixesAreUnnecessaryForIsolation(wrapped)) {
      this.prefix = "";
    } else {
      this.prefix = prefix;
    }
  }

  get(key: string) {
    return this.wrapped.get(this.prefix + key);
  }
  set(key: string, value: V, options?: KeyValueCacheSetOptions) {
    return this.wrapped.set(this.prefix + key, value, options);
  }
  delete(key: string) {
    return this.wrapped.delete(this.prefix + key);
  }
}

// This class lets you opt a cache out of the prefixing provided by
// PrefixingKeyValueCache. See the README for details.
export class PrefixesAreUnnecessaryForIsolationCache<V = string>
  implements KeyValueCache<V>
{
  prefixesAreUnnecessaryForIsolation = true;

  constructor(private wrapped: KeyValueCache<V>) {}

  get(key: string) {
    return this.wrapped.get(key);
  }
  set(key: string, value: V, options?: KeyValueCacheSetOptions) {
    return this.wrapped.set(key, value, options);
  }
  delete(key: string) {
    return this.wrapped.delete(key);
  }
}

// Checks to see if a cache is a PrefixesAreUnnecessaryForIsolationCache,
// without using instanceof (so that installing multiple copies of this package
// doesn't break things).
export function prefixesAreUnnecessaryForIsolation<V>(
  c: KeyValueCache<V>,
): boolean {
  return (
    "prefixesAreUnnecessaryForIsolation" in c &&
    c.prefixesAreUnnecessaryForIsolation === true
  );
}

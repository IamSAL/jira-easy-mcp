/**
 * Jira MCP Server - Cache Module
 * 
 * Simple in-memory cache with TTL support for static Jira data.
 */

import { getConfig } from './config.js';
import { logCacheHit, logCacheMiss } from './logger.js';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class Cache {
  private store: Map<string, CacheEntry<unknown>> = new Map();

  /**
   * Get a value from the cache.
   * Returns undefined if not found or expired.
   */
  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    
    if (!entry) {
      logCacheMiss(key);
      return undefined;
    }

    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      logCacheMiss(key);
      return undefined;
    }

    logCacheHit(key);
    return entry.value as T;
  }

  /**
   * Set a value in the cache.
   * @param key Cache key
   * @param value Value to cache
   * @param ttlSeconds Optional TTL in seconds (defaults to config value)
   */
  set<T>(key: string, value: T, ttlSeconds?: number): void {
    const config = getConfig();
    const ttl = ttlSeconds ?? config.cacheTtl;
    const expiresAt = Date.now() + (ttl * 1000);
    
    this.store.set(key, { value, expiresAt });
  }

  /**
   * Delete a value from the cache.
   */
  delete(key: string): void {
    this.store.delete(key);
  }

  /**
   * Clear all cached values.
   */
  clear(): void {
    this.store.clear();
  }

  /**
   * Get cache statistics.
   */
  stats(): { size: number; keys: string[] } {
    return {
      size: this.store.size,
      keys: Array.from(this.store.keys()),
    };
  }
}

// Singleton cache instance
export const cache = new Cache();

// Cache key generators for consistent key naming
export const CacheKeys = {
  fields: () => 'jira:fields',
  linkTypes: () => 'jira:linkTypes',
  priorities: () => 'jira:priorities',
  statuses: () => 'jira:statuses',
  projects: () => 'jira:projects',
  issueTypes: (projectKey: string) => `jira:issueTypes:${projectKey}`,
  createMeta: (projectKey: string, issueType?: string) => 
    `jira:createMeta:${projectKey}:${issueType || 'all'}`,
};

/**
 * Wrap a function with caching.
 * The function result is cached using the provided key.
 */
export const withCache = async <T>(
  key: string,
  fn: () => Promise<T>,
  ttlSeconds?: number
): Promise<T> => {
  const cached = cache.get<T>(key);
  if (cached !== undefined) {
    return cached;
  }

  const result = await fn();
  cache.set(key, result, ttlSeconds);
  return result;
};

export default cache;

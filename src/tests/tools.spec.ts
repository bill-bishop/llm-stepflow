import { describe, it, expect } from 'vitest';
import { buildToolRegistry } from '../tools/registry.js';

describe('tools registry', () => {
  it('contains expected tools', () => {
    const reg = buildToolRegistry();
    expect(Object.keys(reg)).toContain('web_search');
    expect(Object.keys(reg)).toContain('cli_exec');
    expect(Object.keys(reg)).toContain('http_request');
  });
});

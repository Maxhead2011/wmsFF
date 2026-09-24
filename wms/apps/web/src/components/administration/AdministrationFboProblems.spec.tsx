import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import { AdministrationFboProblems, canManageFboProblems } from './AdministrationFboProblems';
import type { AuthSession } from '../../lib/api';
describe('FBO admin entry point', () => {
    // TEST: ordinary staff and client managers cannot see recovery tools.
    it('shows only to owners and administrators, excluding demo users', () => {
        const session = (role: string, isDemo = false) => ({ accessToken: 'test', user: { roleCodes: [role], isDemo } } as AuthSession);
        for (const role of ['OWNER', 'ADMIN'])
            expect(canManageFboProblems(session(role))).toBe(true);
        for (const role of ['MANAGER', 'CLIENT', 'PICKER'])
            expect(renderToStaticMarkup(<AdministrationFboProblems session={session(role)}/>)).toBe('');
        expect(canManageFboProblems(session('OWNER', true))).toBe(false);
        expect(renderToStaticMarkup(<AdministrationFboProblems session={session('OWNER')}/>)).toContain('Проблемы FBO');
    });
});

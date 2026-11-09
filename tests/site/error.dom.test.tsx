// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ErrorPage from '@/app/error';
import { ErrorView } from '@/components/static/error-view';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the error boundary (app/error.tsx)', () => {
  it('renders inside the site chrome with the digest as the ref, and Try again retries the segment', () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));
    const retry = vi.fn();
    const { container } = render(<ErrorPage error={Object.assign(new Error('do not show this'), { digest: '2846571894' })} retry={retry} />);
    expect(container.querySelector('header.site-header')).toBeTruthy();
    expect(container.querySelector('main#main h1')?.textContent).toBe('Something broke on our side');
    expect(screen.getByText('Nothing was sent to anyone. Ref 2846571894.')).toBeTruthy();
    expect(container.textContent).not.toContain('do not show this');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledTimes(1);
    const primary = container.querySelectorAll('[data-primary]');
    expect(primary.length).toBe(1);
    expect(primary[0]?.textContent).toBe('Try again');
    expect(screen.getByRole('link', { name: 'Try the playground' }).getAttribute('href')).toBe('/');
  });

  it('shows no ref for an error that happened in the browser', () => {
    render(<ErrorView refCode={null} onRetry={() => undefined} />);
    expect(screen.getByText('Nothing was sent to anyone.')).toBeTruthy();
  });
});

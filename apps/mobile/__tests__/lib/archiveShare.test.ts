import { archiveShare, archiveSharePath } from '../../lib/archiveShare';

jest.mock('expo-linking', () => ({
  createURL: (path: string) => `roxy://${path}`,
}));

describe('archiveShare', () => {
  it('carries the link in BOTH fields', () => {
    // Android reads `message`, iOS prefers `url`. Filling one ships a share
    // that is empty on half the installs.
    const out = archiveShare('carol', 'Carol');
    expect(out.url).toBe('roxy:///archive/carol');
    expect(out.message).toContain('roxy:///archive/carol');
  });

  it('names the work, because a film is not a member', () => {
    expect(archiveShare('carol', 'Carol').message).toContain('Carol');
  });

  it('never carries the score or a reviewer out of the app', () => {
    // The verdict is the community's, said inside the community. A share sheet
    // hands its payload to WhatsApp, SMS, a screenshot.
    const out = archiveShare('bound', 'Bound');
    expect(out.message).not.toMatch(/\d+%/);
    expect(out.message).not.toMatch(/@/);
  });

  it('builds the same path the router serves', () => {
    expect(archiveSharePath('gentleman-jack')).toBe('/archive/gentleman-jack');
  });
});

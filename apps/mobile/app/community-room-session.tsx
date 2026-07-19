// Root-level route for the live call stage. The screen must overlay whatever
// tab the user came from — pushing it inside the Connect stack left a stale
// call screen as Connect's top route after leaving (tab tap re-entered a dead
// call). Same pattern as /community/[id].
export { default } from './(tabs)/connect/community-room-session';

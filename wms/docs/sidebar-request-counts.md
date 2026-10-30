# Sidebar request counts

Sidebar and personal favorites display `total (in work)` beside Requests,
FBS and FBO, using the existing KIZ badge style. KIZ remains unchanged.
Numbers are exact (no 99+ truncation). Zero, loading and failed reads have
distinct states; the tooltip explains both numbers.

The unit is a WMS ClientRequest, not a marketplace order, item, carton or
destination. Requests includes every unfinished type. FBS identifies outbound
requests through current links, archived attempt history or legacy titles and
comments. FBO includes the other outbound requests, with explicit Ozon, Lamoda
and Yandex relations taking precedence, matching the existing FBO queues.
DONE, CANCELLED and REJECTED are excluded. The subset counts exactly IN_WORK;
PACKED remains unfinished but is not in work.

`ClientRequestsService.navigationCounts` / GET `client-requests/navigation-counts`
inherits client-requests:read and the same ClientScope/warehouse restrictions as
the request list. It has no 200-row detail limit and makes no writes.
The existing WMS_MARKETPLACE_WORKSPACES_ENABLED flag gates the route; the
matching web flag gates the hook. Sold WMS remains disabled.

App has one shared polling hook for all entries, including favorites.
Refresh every 30 seconds, on focus and visibility/request-change events.
Hidden tabs and overlapping requests are skipped. Branch/session changes
hide old values immediately; cleanup aborts and discards late responses.

Affected source: client-requests service/controller and internal API route count;
App, PantheraNavigation, SidebarRequestCounts and their tests. Runtime overlay:
three API modules, one new core and index.html. Both script src and import map
point to the new core. All existing runtime code outside these insertions is
preserved; no schema, configuration, stock, APK or sold-WMS changes.

Validation: API4119/web571/TypeScript (API156/web2 skipped, dedicated unconfigured
KIZ database suite excluded), actual candidate PostgreSQL6/full API health,
full application browser9 across Panthera/modern, error/zero/recovery/favorites,
exact baseline allow-list. Reproduction/release scripts:
`scripts/releases/sidebar-counts-20261030/`.

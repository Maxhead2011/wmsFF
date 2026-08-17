import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export function ImportMetricGrid({ metrics }) {
    return (_jsx("div", { className: "import-metrics", children: metrics.map((metric) => (_jsxs("div", { className: "import-metric", children: [_jsx("span", { children: metric.label }), _jsx("strong", { children: metric.value })] }, metric.label))) }));
}
export function StockPreviewResult({ preview }) {
    return (_jsxs("div", { className: "import-result", children: [_jsx(ImportMetricGrid, { metrics: [
                    { label: 'Строк', value: preview.summary.rows },
                    { label: 'Коробов', value: preview.summary.boxes },
                    { label: 'Штрихкодов', value: preview.summary.barcodes },
                    { label: 'Штук', value: preview.summary.totalQuantity },
                ] }), _jsx(ImportIssues, { issues: preview.issues }), _jsx(StockCatalogSuggestions, { suggestions: preview.suggestions ?? [] }), _jsx(StockSampleTable, { preview: preview })] }));
}
export function StockCommitResultBlock({ result }) {
    return (_jsxs("div", { className: "import-result", children: [_jsxs("div", { className: "import-result__title", children: [_jsx("h3", { children: "\u041E\u0441\u0442\u0430\u0442\u043A\u0438 \u0437\u0430\u0433\u0440\u0443\u0436\u0435\u043D\u044B" }), _jsx("span", { children: result.sourceDocument })] }), _jsx(ImportMetricGrid, { metrics: [
                    { label: 'Короба', value: result.result.boxesTouched },
                    { label: 'SKU', value: result.result.skusTouched },
                    { label: 'Движения', value: result.result.movementsCreated },
                    { label: 'Балансы', value: result.result.balancesTouched },
                ] }), _jsx(StockCatalogSuggestions, { suggestions: result.suggestions ?? [] }), _jsx(ImportIssues, { issues: result.warnings, emptyText: "\u041F\u0440\u0435\u0434\u0443\u043F\u0440\u0435\u0436\u0434\u0435\u043D\u0438\u0439 \u043D\u0435\u0442." })] }));
}
function StockCatalogSuggestions({ suggestions }) {
    if (!suggestions?.length) {
        return null;
    }
    return (_jsx("div", { className: "import-suggestions", children: suggestions.slice(0, 12).map((suggestion) => (_jsxs("article", { className: suggestion.applied ? 'import-suggestion import-suggestion--applied' : 'import-suggestion', children: [_jsxs("div", { children: [_jsxs("strong", { children: ["\u0421\u0442\u0440\u043E\u043A\u0430 ", suggestion.row, ": ", suggestion.title] }), _jsx("span", { children: suggestion.message })] }), _jsx("span", { className: suggestion.applied ? 'status status--done' : 'status status--planned', children: suggestion.applied ? 'Подставлено' : 'Нужно действие' })] }, `${suggestion.row}-${suggestion.message}`))) }));
}
export function LogisticsPreviewResult({ preview }) {
    return (_jsxs("div", { className: "import-result", children: [_jsx(ImportMetricGrid, { metrics: [
                    { label: 'Направлений', value: preview.directionsCount },
                    { label: 'Ступеней', value: preview.directions.reduce((sum, direction) => sum + direction.tiers.length, 0) },
                    { label: 'Ошибок', value: preview.issues.length },
                ] }), _jsx(ImportIssues, { issues: preview.issues }), preview.note ? _jsx("p", { className: "import-note", children: preview.note }) : null, _jsx("div", { className: "direction-list", children: preview.directions.slice(0, 8).map((direction) => (_jsx(DirectionItem, { direction: direction }, `${direction.origin}-${direction.destination}`))) })] }));
}
export function LogisticsCommitResultBlock({ result }) {
    return (_jsxs("div", { className: "import-result", children: [_jsxs("div", { className: "import-result__title", children: [_jsx("h3", { children: "\u0422\u0430\u0440\u0438\u0444\u044B \u0437\u0430\u0433\u0440\u0443\u0436\u0435\u043D\u044B" }), _jsx("span", { children: result.sourceFile ?? result.name })] }), _jsx(ImportMetricGrid, { metrics: [
                    { label: 'Набор', value: result.name },
                    { label: 'Направлений', value: result.directionsCount },
                    { label: 'Ступеней', value: result.tiersCount },
                ] })] }));
}
function StockSampleTable({ preview }) {
    if (preview.sample.length === 0) {
        return null;
    }
    return (_jsx("div", { className: "import-table-wrap", children: _jsxs("table", { className: "import-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "\u0421\u0442\u0440\u043E\u043A\u0430" }), _jsx("th", { children: "\u041A\u043E\u0440\u043E\u0431" }), _jsx("th", { children: "\u0428\u0442\u0440\u0438\u0445\u043A\u043E\u0434" }), _jsx("th", { children: "\u041D\u0430\u0438\u043C\u0435\u043D\u043E\u0432\u0430\u043D\u0438\u0435" }), _jsx("th", { children: "\u041A\u043E\u043B-\u0432\u043E" })] }) }), _jsx("tbody", { children: preview.sample.map((item) => (_jsxs("tr", { children: [_jsx("td", { children: item.sourceRow }), _jsx("td", { children: item.boxCode }), _jsx("td", { children: item.barcode }), _jsxs("td", { children: [_jsx("strong", { children: item.name }), _jsx("span", { children: [item.color, item.size].filter(Boolean).join(' / ') || 'без параметров' })] }), _jsx("td", { children: item.quantity })] }, `${item.sourceRow}-${item.boxCode}-${item.barcode}`))) })] }) }));
}
function ImportIssues({ issues, emptyText, }) {
    if (issues.length === 0) {
        return emptyText ? _jsx("p", { className: "import-empty", children: emptyText }) : null;
    }
    return (_jsx("div", { className: "import-issues", children: issues.slice(0, 10).map((issue) => (_jsxs("p", { className: issueSeverity(issue) === 'error' ? 'issue issue--error' : 'issue', children: [_jsxs("span", { children: ["\u0421\u0442\u0440\u043E\u043A\u0430 ", issue.row] }), issue.message] }, `${issue.row}-${issue.message}`))) }));
}
function DirectionItem({ direction }) {
    return (_jsxs("article", { className: "direction-item", children: [_jsxs("div", { children: [_jsx("strong", { children: direction.destination }), _jsx("span", { children: direction.origin })] }), _jsx("span", { className: "status status--planned", children: direction.pricingMode }), _jsxs("p", { children: [direction.tiers.length, " \u0441\u0442\u0443\u043F."] })] }));
}
function issueSeverity(issue) {
    return 'severity' in issue ? issue.severity : 'error';
}

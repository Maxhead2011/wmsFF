import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Bell, BellRing, CheckCheck, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { formatCabinetDate } from './clientCabinetFormat';
const preferenceLabels = {
    REQUEST_STATUS_CHANGED: {
        title: 'Заявки',
        caption: 'Статусы и ход обработки заявок',
    },
    REQUEST_FILE_UPLOADED: {
        title: 'Файлы',
        caption: 'Новые вложения в заявках',
    },
    REQUEST_COMMENT: {
        title: 'Комментарии',
        caption: 'Внешние комментарии по заявкам',
    },
    BILLING_INVOICE_STATUS_CHANGED: {
        title: 'Счета',
        caption: 'Изменения статуса счетов',
    },
    BILLING_PAYMENT_RECORDED: {
        title: 'Оплаты',
        caption: 'Поступления по счетам',
    },
    LOGISTICS_DELIVERY_STATUS_CHANGED: {
        title: 'Доставка',
        caption: 'Статусы доставок и рейсов',
    },
    SKU_EXPIRATION: {
        title: 'Срок годности',
        caption: 'Товары со сроком годности под контролем',
    },
    MANUAL: {
        title: 'Сообщения',
        caption: 'Сообщения от менеджера',
    },
};
const preferenceOrder = [
    'REQUEST_STATUS_CHANGED',
    'REQUEST_FILE_UPLOADED',
    'REQUEST_COMMENT',
    'BILLING_INVOICE_STATUS_CHANGED',
    'BILLING_PAYMENT_RECORDED',
    'LOGISTICS_DELIVERY_STATUS_CHANGED',
    'SKU_EXPIRATION',
    'MANUAL',
];
export function ClientCabinetNotifications({ notifications, preferences, browserNotificationPermission, onEnableBrowserNotifications, onMarkRead, onTogglePreference, }) {
    const [showRead, setShowRead] = useState(false);
    const unreadNotifications = notifications.filter((notification) => !notification.isRead);
    const readNotifications = notifications.filter((notification) => notification.isRead);
    const orderedPreferences = preferenceOrder
        .map((eventType) => preferences.find((preference) => preference.eventType === eventType))
        .filter(Boolean);
    return (_jsxs("section", { className: "client-cabinet-notifications", "aria-label": "\u0423\u0432\u0435\u0434\u043E\u043C\u043B\u0435\u043D\u0438\u044F \u043A\u043B\u0438\u0435\u043D\u0442\u0430", children: [_jsxs("div", { className: "client-cabinet-section__heading client-cabinet-notifications__heading", children: [_jsxs("div", { children: [_jsx("h3", { children: "\u0423\u0432\u0435\u0434\u043E\u043C\u043B\u0435\u043D\u0438\u044F" }), _jsxs("span", { className: "status status--planned", children: [unreadNotifications.length, " \u043D\u043E\u0432\u044B\u0445"] })] }), _jsx(BrowserNotificationButton, { permission: browserNotificationPermission, onEnable: onEnableBrowserNotifications })] }), orderedPreferences.length > 0 ? (_jsx("div", { className: "client-notification-preferences", "aria-label": "\u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438 \u0443\u0432\u0435\u0434\u043E\u043C\u043B\u0435\u043D\u0438\u0439", children: orderedPreferences.map((preference) => {
                    const label = preferenceLabels[preference.eventType] ?? {
                        title: preference.eventType,
                        caption: 'Уведомление клиента',
                    };
                    return (_jsxs("label", { className: "client-notification-preference", children: [_jsx("input", { type: "checkbox", checked: preference.isEnabled, onChange: (event) => onTogglePreference(preference, event.target.checked) }), _jsxs("span", { children: [_jsx("strong", { children: label.title }), _jsx("small", { children: label.caption })] })] }, `${preference.clientId}-${preference.eventType}`));
                }) })) : null, unreadNotifications.length === 0 ? (_jsx("p", { className: "panel-message", children: "\u041D\u043E\u0432\u044B\u0445 \u0443\u0432\u0435\u0434\u043E\u043C\u043B\u0435\u043D\u0438\u0439 \u043D\u0435\u0442." })) : (_jsx(NotificationList, { notifications: unreadNotifications, onMarkRead: onMarkRead })), readNotifications.length > 0 ? (_jsxs("div", { className: "client-cabinet-read-notifications", children: [_jsxs("button", { className: "icon-text-button client-cabinet-read-notifications__toggle", type: "button", onClick: () => setShowRead((current) => !current), "aria-expanded": showRead, children: [_jsx(ChevronDown, { size: 16, "aria-hidden": "true" }), _jsx("span", { children: showRead ? 'Свернуть прочитанные' : `Показать прочитанные (${readNotifications.length})` })] }), showRead ? _jsx(NotificationList, { notifications: readNotifications, onMarkRead: onMarkRead }) : null] })) : null] }));
}
function BrowserNotificationButton({ permission, onEnable, }) {
    if (permission === 'granted') {
        return (_jsxs("span", { className: "status status--ready", children: [_jsx(BellRing, { size: 14, "aria-hidden": "true" }), "\u0411\u0440\u0430\u0443\u0437\u0435\u0440 \u0432\u043A\u043B\u044E\u0447\u0435\u043D"] }));
    }
    if (permission === 'unsupported') {
        return _jsx("span", { className: "status status--planned", children: "\u0411\u0440\u0430\u0443\u0437\u0435\u0440 \u043D\u0435 \u043F\u043E\u0434\u0434\u0435\u0440\u0436\u0438\u0432\u0430\u0435\u0442 popup" });
    }
    if (permission === 'denied') {
        return _jsx("span", { className: "status status--planned", children: "\u0420\u0430\u0437\u0440\u0435\u0448\u0438\u0442\u0435 \u0443\u0432\u0435\u0434\u043E\u043C\u043B\u0435\u043D\u0438\u044F \u0432 \u0431\u0440\u0430\u0443\u0437\u0435\u0440\u0435" });
    }
    return (_jsxs("button", { className: "icon-text-button", type: "button", onClick: onEnable, children: [_jsx(BellRing, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: "\u0412\u043A\u043B\u044E\u0447\u0438\u0442\u044C popup" })] }));
}
function NotificationList({ notifications, onMarkRead, }) {
    return (_jsx("div", { className: "client-cabinet-notification-list", children: notifications.map((notification) => (_jsxs("article", { className: `client-cabinet-notification client-cabinet-notification--${notification.severity.toLowerCase()}`, children: [_jsx(Bell, { size: 18, "aria-hidden": "true" }), _jsxs("div", { children: [_jsx("strong", { children: notification.title }), notification.body ? _jsx("span", { children: notification.body }) : null, _jsxs("small", { children: [formatCabinetDate(notification.createdAt), notification.request ? ` · ${notification.request.title}` : ''] })] }), !notification.isRead ? (_jsxs("button", { className: "icon-text-button", type: "button", onClick: () => onMarkRead(notification), title: "\u041E\u0442\u043C\u0435\u0442\u0438\u0442\u044C \u0443\u0432\u0435\u0434\u043E\u043C\u043B\u0435\u043D\u0438\u0435 \u043F\u0440\u043E\u0447\u0438\u0442\u0430\u043D\u043D\u044B\u043C", children: [_jsx(CheckCheck, { size: 15, "aria-hidden": "true" }), _jsx("span", { children: "\u041F\u0440\u043E\u0447\u0438\u0442\u0430\u043D\u043E" })] })) : (_jsx("span", { className: "status status--ready", children: "\u043F\u0440\u043E\u0447\u0438\u0442\u0430\u043D\u043E" }))] }, notification.id))) }));
}

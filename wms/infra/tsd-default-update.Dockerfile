ARG BASE_WEB
FROM ${BASE_WEB}
# FIX: promote the already signed and verified immutable APK; no application rebuild.
RUN cp /usr/share/nginx/html/downloads/logoff-tsd-sorting-recovery-160.apk /usr/share/nginx/html/downloads/logoff-tsd.apk && chmod 0644 /usr/share/nginx/html/downloads/logoff-tsd.apk
COPY logoff-tsd.json /usr/share/nginx/html/downloads/logoff-tsd.json
RUN chmod 0644 /usr/share/nginx/html/downloads/logoff-tsd.json

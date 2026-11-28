from pathlib import Path
import re,sys
b=Path(sys.argv[1]);p=b/'smali/pro/logoff/wms/tsd/ServerSettings.smali';s=p.read_text(encoding='utf8');assert s.count(r' \u00b7 wms.logoff.pro')==1 and s.count(r' \u00b7 77.37.144.211')==1;s=s.replace(r' \u00b7 wms.logoff.pro','').replace(r' \u00b7 77.37.144.211','');p.write_text(s,encoding='utf8')
p=b/'smali/pro/logoff/wms/tsd/MainActivity$6.smali';s=p.read_text(encoding='utf8');start=s.index('    const-string p4, "\\n"');end=s.index('    const-string p4, "\\n\\u041d',start);assert 'ServerSettings;->baseUrl' in s[start:end];s=s[:start]+s[end:];assert 'ServerSettings;->baseUrl' not in s;p.write_text(s,encoding='utf8')
print('Server labels and confirmation hide addresses; endpoints preserved')

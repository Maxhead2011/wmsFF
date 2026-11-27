"""Materialize the reviewed delta over the deployed allocation and retry worker."""
from pathlib import Path
import sys, subprocess
root=Path(sys.argv[1]);mod=root/'modules/marketplace-connections';p=mod/'marketplace-connections.service.js';s=p.read_text(encoding='utf8')
def replace(a,b):
 global s
 assert s.count(a)==1,a
 s=s.replace(a,b)
replace('"use strict";','"use strict";\nconst {saveWbPublicationChoices} = require("./wb-disable-verification");')
i=s.index('    async updateFbsStockPublicationFresh(');j=s.index('        const stockPlan =',s.index('const publication = await this.prisma.fbsStockPublication.upsert',i))
a=s[i:j];a=a.replace('const publication = await this.prisma.fbsStockPublication.upsert','const [publication] = await saveWbPublicationChoices(this.prisma, [this.prisma.fbsStockPublication.upsert');assert a.endswith('        });\n');s=s[:i]+a[:-len('        });\n')]+'        })], clientId, [sku.id], dto.enabled, false);\n'+s[j:]
i=s.index('        const publications = await this.prisma.$transaction(prepared.map',s.index('    async updateFbsStockPublicationBulkFresh'));j=s.index('        const publicationBySku',i)
a=s[i:j];assert a.endswith('        })));\n');s=s[:i]+a.replace('this.prisma.$transaction(prepared.map','saveWbPublicationChoices(this.prisma, prepared.map')[:-len('        })));\n')]+'        })), clientId, prepared.map(item => item.sku.id), dto.enabled, true);\n'+s[j:]
i=s.index('        const enabledSkuIds = quantities');j=s.index('        const preparedByWarehouse',i);assert s[i:j].count('in: desiredWarehouseIds')==2;s=s[:i]+s[i:j].replace('in: desiredWarehouseIds','in: desiredWarehouseIds, not: primaryWarehouseId')+s[j:]
replace('const needsSync = publication.lastSyncedAmount !== row.amount','const needsSync = (!row.enabled && wb_stock_sync_queue_1.isUrgentWbStockSync()) || publication.lastSyncedAmount !== row.amount')
replace('const needsSync = publication.lastSyncedAmount !== amounts.targetAmount','const needsSync = (!publication.enabled && wbAmounts.get(ids.chrtId) > 0) || publication.lastSyncedAmount !== amounts.targetAmount')
p.write_bytes(s.encode())
subprocess.run(['node','-e',"""const fs=require('fs'),ts=require('typescript');fs.writeFileSync(process.argv[2],ts.transpileModule(fs.readFileSync(process.argv[1],'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)""",str(Path('apps/api/src/modules/marketplace-connections/wb-disable-verification.ts')),str((mod/'wb-disable-verification.js').resolve())],check=True)

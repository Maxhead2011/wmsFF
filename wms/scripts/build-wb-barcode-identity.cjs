// FIX: retain the verified runtime catalog workflow, changing only identity review.
const fs=require('fs'),path=require('path'),ts=require('../node_modules/typescript');
const root=process.argv[2],dir=path.join(root,'modules/marketplace-connections');
const file=path.join(dir,'wb-catalog-sync.js');let code=fs.readFileSync(file,'utf8');
function once(a,b){if(code.split(a).length!==2)throw Error('Runtime anchor drift: '+a);code=code.replace(a,b);}
const ast=ts.createSourceFile('runtime.js',code,99,true);
const classifier=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='classifyWbCatalog');
if(!classifier)throw Error('Missing classifier');
code=code.slice(0,classifier.getStart(ast))+'function classifyWbCatalog(skus, products, owners = skus) { return barcodeCatalogReview(skus, products, owners, catalogIdentityMatches).excluded; }'+code.slice(classifier.end);
once('const excluded = classifyWbCatalog(existing, products);',`const owners = await db.sku.findMany({where:{clientId:connection.clientId},select:{id:true,marketplaceOfferId:true,barcodes:{select:{value:true}}}});
            const review = barcodeCatalogReview(existing, products, owners, catalogIdentityMatches);
            const excluded = review.excluded, warnings = review.warnings;
            const warningSkuIds = new Set(warnings.map(w => w.skuId));
            const verifiedUpdates = new Map(existing.filter(s => warningSkuIds.has(s.id)).map(s => [s.marketplaceProductId, s.id]));`);
once('marketplaceOfferId: true, article: true, size: true','marketplaceOfferId: true, barcodes: {select:{value:true}}, article: true, size: true');
once('const initial = { startedAt, completedAt: lastSuccess ?? null, excluded };','const initial = { startedAt, completedAt: lastSuccess ?? null, excluded, warnings };');
once('const saved = await upsert(product);','const saved = await (verifiedUpdates.has(product.productId) ? withVerifiedBarcodeUpdate(verifiedUpdates.get(product.productId), product, () => upsert(product)) : upsert(product));');
once('value: { startedAt, completedAt, excluded, result }','value: { startedAt, completedAt, excluded, warnings, result }');
once('payload: { startedAt, completedAt, result, excluded }','payload: { startedAt, completedAt, result, excluded, warnings }');
code='const {barcodeCatalogReview, withVerifiedBarcodeUpdate} = require("./wb-barcode-identity");\n'+code;
const helper=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../apps/api/src/modules/marketplace-connections/wb-barcode-identity.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
fs.writeFileSync(file,code);fs.writeFileSync(path.join(dir,'wb-barcode-identity.js'),helper);
const serviceFile=path.join(dir,'marketplace-connections.service.js');
let service=fs.readFileSync(serviceFile,'utf8');
function serviceOnce(a,b){if(service.split(a).length!==2)throw Error('Service anchor drift: '+a);service=service.replace(a,b);}
serviceOnce("if (existing && !existing.isDraft && product.marketplace === client_1.MarketplaceType.WILDBERRIES && !(0, wb_catalog_sync_1.catalogIdentityMatches)(existing, product)) {", "if (existing && !existing.isDraft && product.marketplace === client_1.MarketplaceType.WILDBERRIES && !isVerifiedBarcodeUpdate(existing, product) && !(0, wb_catalog_sync_1.catalogIdentityMatches)(existing, product)) {");
serviceOnce('data.size = existing.size;', 'if (!isVerifiedBarcodeUpdate(existing, product)) data.size = existing.size;');
fs.writeFileSync(serviceFile,'const {isVerifiedBarcodeUpdate} = require("./wb-barcode-identity");\n'+service);

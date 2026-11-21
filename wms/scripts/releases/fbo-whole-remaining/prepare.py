from pathlib import Path
import sys
web,index,helper,out=map(Path,sys.argv[1:])
s=web.read_text(encoding='utf-8');anchor='`Упаковано коробов: ${s.boxStatistics.packedBoxes}`})]}'
assert s.count(anchor)==1
s=s.replace(anchor,'`Упаковано коробов: ${s.boxStatistics.packedBoxes}`}),p==="Упаковка"&&s.boxStatistics?.remainingWholeBoxes!==undefined&&e.jsx("p",{className:"fbo-box-count",children:`Осталось упаковать целых коробов: ${s.boxStatistics.remainingWholeBoxes}`})]}',1)
def save(name,data):
 p=out/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(data,encoding='utf-8')
save('web-payload/assets/fbo-whole-remaining-20261121.js',s)
s=index.read_text(encoding='utf-8');assert '/assets/fbo-box-progress-20261121.js' in s
save('web-payload/index.html',s.replace('/assets/fbo-box-progress-20261121.js','/assets/fbo-whole-remaining-20261121.js'))
save('api-payload/modules/tsd/fbo-box-statistics.js',helper.read_text(encoding='utf-8'))

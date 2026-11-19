import java.io.*;
import java.util.*;
import com.android.tools.smali.dexlib2.*;
import com.android.tools.smali.dexlib2.iface.*;
import com.android.tools.smali.dexlib2.immutable.*;
import com.android.tools.smali.dexlib2.immutable.value.*;
import com.android.tools.smali.dexlib2.writer.pool.DexPool;
import com.android.tools.smali.baksmali.*;
class Overlay {
 public static void main(String[] a)throws Exception {
  var op=Opcodes.forApi(35);var base=DexFileFactory.loadDexFile(new File(a[0]),op);
  var main=DexFileFactory.loadDexFile(new File(a[1]),op);
  String root="Lpro/logoff/wms/tsd/",screen=root+"FboTwoStageScreen;",helper=root+"FboTwoStageScreen$$ExternalSyntheticBackport0;";
  Map<String,ClassDef> replacements=new HashMap<>();
  for(var c:main.getClasses())if(c.getType().equals(screen)||c.getType().equals(helper))replacements.put(c.getType(),c);
  if(replacements.size()!=2)throw new IllegalStateException("Unexpected published screen classes");
  List<ClassDef> classes=new ArrayList<>();
  // FIX: preserve server selection, receipt drafts, update hooks and storage bytecode.
  for(var c:base.getClasses()){
   if(c.getType().equals(screen)){classes.add(replacements.remove(screen));continue;}
   if(c.getType().equals(root+"BuildConfig;")){
    List<Field> fields=new ArrayList<>();
    for(var f:c.getFields()){
     var v=f.getInitialValue();
     if(f.getName().equals("VERSION_CODE"))v=new ImmutableIntEncodedValue(263);
     if(f.getName().equals("VERSION_NAME"))v=new ImmutableStringEncodedValue("0.1.263-packing-modes");
     fields.add(new ImmutableField(f.getDefiningClass(),f.getName(),f.getType(),f.getAccessFlags(),v,f.getAnnotations(),f.getHiddenApiRestrictions()));
    }
    classes.add(new ImmutableClassDef(c.getType(),c.getAccessFlags(),c.getSuperclass(),c.getInterfaces(),c.getSourceFile(),c.getAnnotations(),fields,c.getMethods()));
   }else classes.add(c);
  }
  classes.add(Objects.requireNonNull(replacements.remove(helper)));
  DexPool.writeTo(a[2],new ImmutableDexFile(Opcodes.forApi(28),classes));
  // TEST: deterministic normalized bytecode for every class, including unchanged queue and session classes.
  for(int i=0;i<3;i++){
   var dex=DexFileFactory.loadDexFile(new File(a[i]),op);var opts=new BaksmaliOptions();opts.debugInfo=false;
   File dir=new File(a[3],"inspect"+i);dir.mkdirs();
   if(!Baksmali.disassembleDexFile(dex,dir,4,opts))throw new IOException("Disassembly failed");
  }
 }
}

import java.io.*;
import java.util.*;
import com.android.tools.smali.dexlib2.*;
import com.android.tools.smali.dexlib2.iface.*;
import com.android.tools.smali.dexlib2.immutable.*;
import com.android.tools.smali.dexlib2.immutable.value.*;
import com.android.tools.smali.dexlib2.writer.pool.DexPool;
import com.android.tools.smali.baksmali.*;
import com.android.tools.smali.dexlib2.iface.instruction.formats.Instruction21c;
import com.android.tools.smali.dexlib2.iface.reference.StringReference;
import com.android.tools.smali.dexlib2.immutable.instruction.ImmutableInstruction21c;
import com.android.tools.smali.dexlib2.immutable.reference.ImmutableStringReference;
class Overlay {
 public static void main(String[] a)throws Exception {
  var op=Opcodes.forApi(35);var base=DexFileFactory.loadDexFile(new File(a[0]),op);
  var main=DexFileFactory.loadDexFile(new File(a[1]),op);
  String root="Lpro/logoff/wms/tsd/",screen=root+"FboTwoStageScreen;",helper=root+"FboTwoStageScreen$$ExternalSyntheticBackport0;";
  Map<String,ClassDef> replacements=new HashMap<>();
  for(var c:main.getClasses())if(c.getType().equals(screen)||c.getType().equals(helper))replacements.put(c.getType(),c);
  if(replacements.size()!=2)throw new IllegalStateException("Unexpected published screen classes");
  List<ClassDef> classes=new ArrayList<>();int monitorVersions=0;
  // FIX: preserve server selection, receipt drafts, update hooks and storage bytecode.
  for(var c:base.getClasses()){
   if(c.getType().equals(screen)){classes.add(replacements.remove(screen));continue;}
   if(c.getType().equals(root+"MainActivity;")){
    List<Method> methods=new ArrayList<>();
    for(var m:c.getMethods()){
     var impl=m.getImplementation();
     if(impl==null){methods.add(m);continue;}
     List<com.android.tools.smali.dexlib2.iface.instruction.Instruction> instructions=new ArrayList<>();
     for(var i:impl.getInstructions()){
      if(i instanceof Instruction21c x && x.getReference() instanceof StringReference s && s.getString().equals("0.1.261-receipt-draft")){
       instructions.add(new ImmutableInstruction21c(i.getOpcode(),x.getRegisterA(),new ImmutableStringReference("0.1.264-packing-modes")));monitorVersions++;
      }else instructions.add(i);
     }
     methods.add(new ImmutableMethod(m.getDefiningClass(),m.getName(),m.getParameters(),m.getReturnType(),m.getAccessFlags(),m.getAnnotations(),m.getHiddenApiRestrictions(),new ImmutableMethodImplementation(impl.getRegisterCount(),instructions,impl.getTryBlocks(),impl.getDebugItems())));
    }
    classes.add(new ImmutableClassDef(c.getType(),c.getAccessFlags(),c.getSuperclass(),c.getInterfaces(),c.getSourceFile(),c.getAnnotations(),c.getFields(),methods));
   }else if(c.getType().equals(root+"BuildConfig;")){
    List<Field> fields=new ArrayList<>();
    for(var f:c.getFields()){
     var v=f.getInitialValue();
     if(f.getName().equals("VERSION_CODE"))v=new ImmutableIntEncodedValue(264);
     if(f.getName().equals("VERSION_NAME"))v=new ImmutableStringEncodedValue("0.1.264-packing-modes");
     fields.add(new ImmutableField(f.getDefiningClass(),f.getName(),f.getType(),f.getAccessFlags(),v,f.getAnnotations(),f.getHiddenApiRestrictions()));
    }
    classes.add(new ImmutableClassDef(c.getType(),c.getAccessFlags(),c.getSuperclass(),c.getInterfaces(),c.getSourceFile(),c.getAnnotations(),fields,c.getMethods()));
   }else classes.add(c);
  }
  if(monitorVersions!=1)throw new IllegalStateException("Unexpected monitoring version constants: "+monitorVersions);
  classes.add(Objects.requireNonNull(replacements.remove(helper)));
  DexPool.writeTo(a[2],new ImmutableDexFile(Opcodes.forApi(28),classes));
  // TEST: compare every class in memory; write only the reviewed delta for Python checks.
  List<Map<String,String>> snapshots=new ArrayList<>();
  for(int i=0;i<3;i++){
   var dex=DexFileFactory.loadDexFile(new File(a[i]),op);var opts=new BaksmaliOptions();opts.debugInfo=false;
   File dir=new File(a[3],"inspect"+i);dir.mkdirs();
   Map<String,String> snapshot=new TreeMap<>();
   for(var c:dex.getClasses()){
    var text=new StringWriter();var writer=new com.android.tools.smali.baksmali.formatter.BaksmaliWriter(text);
    var def=new com.android.tools.smali.baksmali.Adaptors.ClassDefinition(opts,c);def.writeTo(writer);writer.flush();
    if(def.hadValidationErrors())throw new IOException("Invalid class "+c.getType());
    snapshot.put(c.getType(),text.toString());
    if(Set.of(screen,helper,root+"BuildConfig;",root+"MainActivity;").contains(c.getType())){
     var path=new File(dir,c.getType().substring(1,c.getType().length()-1)+".smali");path.getParentFile().mkdirs();
     java.nio.file.Files.writeString(path.toPath(),text.toString());
    }
   }
   snapshots.add(snapshot);
  }
  var old=snapshots.get(0);var fresh=snapshots.get(2);
  if(fresh.size()!=old.size()+1||old.containsKey(helper)||!fresh.containsKey(helper))throw new IllegalStateException("Class inventory changed");
  for(var name:old.keySet())if(!Set.of(screen,root+"BuildConfig;",root+"MainActivity;").contains(name)&&!Objects.equals(old.get(name),fresh.get(name)))throw new IllegalStateException("Unapproved class change "+name);
 }
}

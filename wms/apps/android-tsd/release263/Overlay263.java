import java.io.*;
import java.util.*;
import com.android.tools.smali.dexlib2.*;
import com.android.tools.smali.dexlib2.iface.*;
import com.android.tools.smali.dexlib2.immutable.*;
import com.android.tools.smali.dexlib2.immutable.value.*;
import com.android.tools.smali.dexlib2.writer.pool.DexPool;

class Overlay263 {
 public static void main(String[] a)throws Exception {
  var op=Opcodes.forApi(35);
  var base=DexFileFactory.loadDexFile(new File(a[0]),op);
  var fix=DexFileFactory.loadDexFile(new File(a[1]),op);
  String root="Lpro/logoff/wms/tsd/";
  String screen=root+"FboTwoStageScreen;";
  Map<String,Method> methods=new HashMap<>();
  for(var c:fix.getClasses()) if(c.getType().equals(screen))
   for(var m:c.getMethods()) methods.put(m.toString(),m);
  List<ClassDef> classes=new ArrayList<>();
  int replacements=0;
  for(var c:base.getClasses()){
   if(c.getType().equals(screen)){
    List<Method> merged=new ArrayList<>();
    for(var m:c.getMethods()){
     String name=m.getName();
     if(Set.of("productOnly","resumeProductOnly","chooseProductMode").contains(name)){
      merged.add(Objects.requireNonNull(methods.remove(m.toString()),m.toString()));
      replacements++;
     }else merged.add(m);
    }
    classes.add(new ImmutableClassDef(c.getType(),c.getAccessFlags(),c.getSuperclass(),c.getInterfaces(),c.getSourceFile(),c.getAnnotations(),c.getFields(),merged));
   }else if(c.getType().equals(root+"BuildConfig;")){
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
  if(replacements!=3)throw new IllegalStateException("Unexpected method count "+replacements);
  DexPool.writeTo(a[2],new ImmutableDexFile(Opcodes.forApi(28),classes));
 }
}


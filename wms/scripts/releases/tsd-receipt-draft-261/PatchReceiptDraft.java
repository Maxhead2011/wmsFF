import java.io.*;
import java.util.*;
import com.android.tools.smali.dexlib2.*;
import com.android.tools.smali.dexlib2.iface.*;
import com.android.tools.smali.dexlib2.iface.instruction.*;
import com.android.tools.smali.dexlib2.iface.instruction.formats.*;
import com.android.tools.smali.dexlib2.iface.reference.*;
import com.android.tools.smali.dexlib2.iface.value.*;
import com.android.tools.smali.dexlib2.immutable.*;
import com.android.tools.smali.dexlib2.immutable.instruction.*;
import com.android.tools.smali.dexlib2.immutable.reference.*;
import com.android.tools.smali.dexlib2.immutable.value.*;
import com.android.tools.smali.dexlib2.writer.pool.DexPool;
import com.android.tools.smali.baksmali.*;

// FIX: fail-closed, method-only adapter over the exact production APK260 DEX.
public final class PatchReceiptDraft {
 static final String ROOT="Lpro/logoff/wms/tsd/", HOOK=ROOT+"ReceiptDraftHooks;";
 static final String OLD="0.1.260-receipt-voice", NEW="0.1.261-receipt-draft";
 static final String SUFFIX="$receiptDraftOriginal";
 static List<Instruction> code(Instruction... i){return Arrays.asList(i);}
 static ImmutableMethodReference ref(String owner,String name,List<? extends CharSequence> params,String ret){return new ImmutableMethodReference(owner,name,params,ret);}
 static Instruction hook(String name,int register){return new ImmutableInstruction35c(Opcode.INVOKE_STATIC,1,register,0,0,0,0,ref(HOOK,name,List.of("Ljava/lang/Object;"),name.equals("beforeOpen")||name.equals("enterClose")?"Z":"V"));}
 static Instruction exit(){return new ImmutableInstruction35c(Opcode.INVOKE_STATIC,0,0,0,0,0,0,ref(HOOK,"exitClose",List.of(),"V"));}
 static Instruction original(Method m,int start,int count){return new ImmutableInstruction3rc((m.getAccessFlags()&8)!=0?Opcode.INVOKE_STATIC_RANGE:Opcode.INVOKE_DIRECT_RANGE,start,count,ref(m.getDefiningClass(),m.getName()+SUFFIX,m.getParameterTypes(),m.getReturnType()));}
 static Method copy(Method m,String name,int flags,MethodImplementation impl){return new ImmutableMethod(m.getDefiningClass(),name,m.getParameters(),m.getReturnType(),flags,m.getAnnotations(),m.getHiddenApiRestrictions(),impl);}
 static List<Method> wrap(Method m,String kind){
  if(m.getImplementation()==null)throw new IllegalStateException("No implementation: "+m);
  List<Instruction> ins;int regs;List<ImmutableTryBlock> tries=List.of();
  switch(kind){
   case "open": regs=2;ins=code(hook("beforeOpen",1),new ImmutableInstruction11x(Opcode.MOVE_RESULT,0),new ImmutableInstruction21t(Opcode.IF_EQZ,0,8),original(m,1,1),hook("afterOpen",1),new ImmutableInstruction10x(Opcode.RETURN_VOID));break;
   case "add": regs=6;ins=code(new ImmutableInstruction3rc(Opcode.INVOKE_STATIC_RANGE,1,5,ref(HOOK,"beforeAdd",List.of("Ljava/lang/Object;","Ljava/lang/String;","Ljava/lang/String;","Ljava/lang/Object;","Ljava/lang/String;"),"Z")),new ImmutableInstruction11x(Opcode.MOVE_RESULT,0),new ImmutableInstruction21t(Opcode.IF_EQZ,0,8),original(m,1,5),hook("afterAdd",1),new ImmutableInstruction10x(Opcode.RETURN_VOID));break;
   case "close": regs=5;ins=code(hook("enterClose",1),new ImmutableInstruction11x(Opcode.MOVE_RESULT,0),new ImmutableInstruction21t(Opcode.IF_EQZ,0,8),original(m,1,4),exit(),new ImmutableInstruction10x(Opcode.RETURN_VOID),new ImmutableInstruction11x(Opcode.MOVE_EXCEPTION,0),exit(),new ImmutableInstruction11x(Opcode.THROW,0));tries=List.of(new ImmutableTryBlock(6,3,List.of(new ImmutableExceptionHandler(null,13))));break;
   case "create": regs=5;ins=code(original(m,1,4),new ImmutableInstruction11x(Opcode.MOVE_RESULT_OBJECT,0),hook("afterBatchCreated",0),new ImmutableInstruction11x(Opcode.RETURN_OBJECT,0));break;
   case "enqueue": regs=2;ins=code(original(m,0,2),hook("onBatchEnqueued",1),new ImmutableInstruction10x(Opcode.RETURN_VOID));break;
   case "update": regs=2;ins=code(hook("beforeUpdate",1),original(m,1,1),new ImmutableInstruction11x(Opcode.MOVE_RESULT_OBJECT,0),new ImmutableInstruction11x(Opcode.RETURN_OBJECT,0));break;
   default:throw new IllegalArgumentException(kind);
  }
  return List.of(copy(m,m.getName()+SUFFIX,(m.getAccessFlags()&~5)|2,m.getImplementation()),copy(m,m.getName(),m.getAccessFlags(),new ImmutableMethodImplementation(regs,ins,tries,List.of())));
 }
 static Method version(Method m){
  if(m.getImplementation()==null)return m;
  List<Instruction> ins=new ArrayList<>();boolean changed=false;
  for(Instruction i:m.getImplementation().getInstructions()){
   if(i instanceof ReferenceInstruction r && r.getReference() instanceof StringReference s && s.getString().equals(OLD)){
    if(i instanceof Instruction21c a)i=new ImmutableInstruction21c(i.getOpcode(),a.getRegisterA(),new ImmutableStringReference(NEW));
    else if(i instanceof Instruction31c a)i=new ImmutableInstruction31c(i.getOpcode(),a.getRegisterA(),new ImmutableStringReference(NEW));
    else throw new IllegalStateException("Unknown version instruction");changed=true;
   }ins.add(i);
  }
  if(!changed)return m;MethodImplementation impl=m.getImplementation();return copy(m,m.getName(),m.getAccessFlags(),new ImmutableMethodImplementation(impl.getRegisterCount(),ins,impl.getTryBlocks(),impl.getDebugItems()));
 }
 static ClassDef with(ClassDef c,List<Field> fields,List<Method> methods){return new ImmutableClassDef(c.getType(),c.getAccessFlags(),c.getSuperclass(),c.getInterfaces(),c.getSourceFile(),c.getAnnotations(),fields,methods);}
 static Map<String,ClassDef> classes(DexFile d){Map<String,ClassDef> out=new TreeMap<>();for(ClassDef c:d.getClasses())out.put(c.getType(),c);return out;}
 public static void main(String[] args)throws Exception{
  Opcodes op=Opcodes.forApi(35);DexFile base=DexFileFactory.loadDexFile(new File(args[0]),op),aux=DexFileFactory.loadDexFile(new File(args[1]),op),hooks=DexFileFactory.loadDexFile(new File(args[2]),op);
  Map<String,ClassDef> out=classes(base),auxMap=classes(aux);Set<String> patched=new TreeSet<>();int wrappers=0;
  String packageId=null;for(Field f:out.get(ROOT+"BuildConfig;").getFields())if(f.getName().equals("APPLICATION_ID")&&f.getInitialValue() instanceof StringEncodedValue v)packageId=v.getValue();
  if(!List.of("pro.logoff.wms.tsd","pro.logoff.wms.tsd.servers").contains(packageId))throw new IllegalStateException("Unsupported package");
  boolean servers=packageId.equals("pro.logoff.wms.tsd.servers");
  ClassDef receipt=out.get(ROOT+"MainActivity$ReceiptItem;");if(receipt==null)throw new IllegalStateException("No receipt item class");
  for(Field f:receipt.getFields())if(!List.of("Ljava/lang/String;","Ljava/util/Map;","I","J","Z").contains(f.getType()))throw new IllegalStateException("Unsupported receipt item field: "+f);
  Method restore=null;for(Method m:auxMap.get(ROOT+"data/ReceiptCloseBatch;").getMethods())if(m.getName().equals("restore"))restore=m;
  if(restore==null)throw new IllegalStateException("Missing reviewed restore method");
  for(ClassDef c:base.getClasses()){
   List<Method> methods=new ArrayList<>();List<Field> fields=new ArrayList<>();boolean changed=false;
   for(Method original:c.getMethods()){
    if(original.getName().endsWith(SUFFIX))throw new IllegalStateException("Already patched baseline");
    Method m=version(original);if(m!=original)changed=true;String kind=null;
    if(c.getType().equals(ROOT+"MainActivity;")){
     if(m.getName().equals("openReceiptBoxFromInput")&&m.getParameterTypes().isEmpty())kind="open";
     if(m.getName().equals("addReceiptItem")&&m.getParameterTypes().size()==4)kind="add";
     if(m.getName().equals("closeReceiptBoxOnServer")&&m.getParameterTypes().size()==3)kind="close";
     if(servers&&m.getName().equals("downloadAndVerifyUpdateApk")&&m.getParameterTypes().isEmpty()&&m.getReturnType().equals("Ljava/io/File;"))kind="update";
    }
    if(c.getType().equals(ROOT+"data/ReceiptCloseBatch;")&&m.getName().equals("create")&&m.getParameterTypes().size()==4)kind="create";
    if(c.getType().equals(ROOT+"data/OperationOutbox;")&&m.getName().equals("enqueueReceiptBatch")&&m.getParameterTypes().size()==1)kind="enqueue";
    if(kind!=null){methods.addAll(wrap(m,kind));changed=true;wrappers++;}else methods.add(m);
   }
   for(Field f:c.getFields()){
    if(c.getType().equals(ROOT+"BuildConfig;")&&f.getName().equals("VERSION_CODE")){if(!(f.getInitialValue() instanceof IntEncodedValue v)||v.getValue()!=260)throw new IllegalStateException("Wrong baseline version");f=new ImmutableField(f.getDefiningClass(),f.getName(),f.getType(),f.getAccessFlags(),new ImmutableIntEncodedValue(261),f.getAnnotations(),f.getHiddenApiRestrictions());changed=true;}
    else if(f.getInitialValue() instanceof StringEncodedValue v && v.getValue().equals(OLD)){f=new ImmutableField(f.getDefiningClass(),f.getName(),f.getType(),f.getAccessFlags(),new ImmutableStringEncodedValue(NEW),f.getAnnotations(),f.getHiddenApiRestrictions());changed=true;}
    fields.add(f);
   }
   if(c.getType().equals(ROOT+"data/ReceiptCloseBatch;")){for(Method m:c.getMethods())if(m.getName().equals("restore"))throw new IllegalStateException("Existing restore method");methods.add(restore);changed=true;}
   if(changed){out.put(c.getType(),with(c,fields,methods));patched.add(c.getType());}
  }
  if(wrappers!=(servers?6:5))throw new IllegalStateException("Unexpected hook count: "+wrappers);
  for(ClassDef c:aux.getClasses())if(c.getType().equals(ROOT+"data/ReceiptBoxDraft;")||c.getType().equals(ROOT+"data/ReceiptBoxDraft$Snapshot;")){if(out.putIfAbsent(c.getType(),c)!=null)throw new IllegalStateException("Draft already exists");}
  for(ClassDef c:hooks.getClasses()){if(!c.getType().startsWith(ROOT+"ReceiptDraftHooks"))throw new IllegalStateException("Unexpected helper "+c.getType());if(out.putIfAbsent(c.getType(),c)!=null)throw new IllegalStateException("Hook already exists");}
  DexFile result=new ImmutableDexFile(op,out.values());DexPool.writeTo(args[3],result);
  BaksmaliOptions options=new BaksmaliOptions();options.debugInfo=false;
  if(!Baksmali.disassembleDexFile(base,new File(args[4]),4,options)||!Baksmali.disassembleDexFile(DexFileFactory.loadDexFile(new File(args[3]),op),new File(args[5]),4,options))throw new IllegalStateException("Disassembly failed");
  System.out.println("Patched classes: "+patched+"; wrappers="+wrappers+"; classes="+out.size());
 }
}

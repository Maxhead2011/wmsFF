import java.io.*;
import com.android.tools.smali.dexlib2.*;
import com.android.tools.smali.baksmali.*;
class InspectDex {
 public static void main(String[] a)throws Exception {
  var dex=DexFileFactory.loadDexFile(new File(a[0]),Opcodes.forApi(35));
  var opts=new BaksmaliOptions();opts.debugInfo=false;
  if(!Baksmali.disassembleDexFile(dex,new File(a[1]),4,opts))throw new IOException("Disassembly failed");
 }
}

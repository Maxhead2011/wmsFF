package pro.logoff.wms.tsd;

import java.io.*;
import java.util.*;
import java.util.regex.*;

/** FIX: translate presentation templates; interpolated identifiers stay byte-for-byte intact. */
final class TsdTextCatalog {
    private final Map<String,String[]> words=new LinkedHashMap<>();
    private final List<Template> templates=new ArrayList<>();
    private List<String> fragments=Collections.emptyList();
    static TsdTextCatalog load(Reader translations, Reader patterns) throws IOException {
        TsdTextCatalog result=new TsdTextCatalog();
        try(BufferedReader reader=new BufferedReader(translations)) {
            String line;int number=0;
            while((line=reader.readLine())!=null) {
                number++;if(line.isEmpty()||line.startsWith("#"))continue;
                String[] columns=line.split("\t",-1);
                if(columns.length!=3)throw new IOException("Invalid translation row "+number);
                for(int i=0;i<columns.length;i++)columns[i]=unescape(columns[i]);
                if(columns[0].isEmpty()||columns[1].isEmpty()||columns[2].isEmpty())throw new IOException("Empty translation row "+number);
                String[] prior=result.words.put(columns[0],columns);
                if(prior!=null&&!Arrays.equals(prior,columns))throw new IOException("Duplicate translation row "+number);
            }
        }
        for(String[] row:new ArrayList<>(result.words.values())) {
            String key=row[0].trim();
            if(!key.isEmpty())result.words.putIfAbsent(key,new String[]{key,row[1].trim(),row[2].trim()});
        }
        result.fragments=new ArrayList<>(result.words.keySet());
        result.fragments.sort(Comparator.comparingInt(String::length).reversed());
        try(BufferedReader reader=new BufferedReader(patterns)) {
            String line;Set<String> seen=new HashSet<>();
            while((line=reader.readLine())!=null) {
                if(line.isEmpty()||line.startsWith("#"))continue;
                String pattern=unescape(line);
                if(seen.add(pattern))result.templates.add(new Template(pattern));
            }
        }
        result.templates.sort(Comparator.comparingInt((Template t)->t.specificity).reversed());
        for(String[] row:result.words.values())if(row[0].contains("{0}")) {
            result.templates.removeIf(t->t.canonical.equals(row[0]));result.templates.add(new Template(row[0]));
        }
        // FIX: StringBuilder captions (for example pallet + code) are single-line templates too.
        for(String[] row:result.words.values())if(row[0].endsWith(": ")&&!row[0].contains("\n")&&!row[0].contains("{0}")) {
            Template caption=new Template(row[0]+"{0}");caption.singleLine=true;result.templates.add(caption);
        }
        result.templates.sort(Comparator.comparingInt((Template t)->t.specificity).reversed());
        for(Template template:result.templates)for(int lang=1;lang<=2;lang++) {
            String[] explicit=result.words.get(template.canonical);
            if(explicit!=null) {
                Template localized=new Template(explicit[lang]);
                if(localized.parts.size()!=template.parts.size())throw new IOException("Translation changes template arguments");
                template.translated[lang]=localized.parts;continue;
            }
            template.translated[lang]=new ArrayList<>();
            for(String part:template.parts)template.translated[lang].add(result.staticText(part,lang));
        }
        return result;
    }
    String text(String canonical,String code) {
        if(canonical==null)return "";
        int lang=TsdLanguage.index(code);if(lang==0||canonical.isEmpty())return canonical;
        return render(canonical,lang,0);
    }
    boolean contains(String key){return words.containsKey(key);}
    int size(){return words.size();}
    private String render(String source,int lang,int depth) {
        String[] entry=words.get(source);if(entry!=null)return entry[lang];
        if(source.length()>16000||depth>8)return source;
        for(Template template:templates) {
            List<String> captures=template.match(source);if(captures==null)continue;
            StringBuilder out=new StringBuilder();
            for(int i=0;i<template.parts.size();i++) {
                out.append(template.translated[lang].get(i));
                // Captures are data, not another translation input.
                if(i+1<template.parts.size())out.append(captures.get(i));
            }
            return out.toString();
        }
        for(String delimiter:new String[]{"\n"," · "," → "}) {
            if(source.contains(delimiter)) {
                String[] parts=source.split(Pattern.quote(delimiter),-1);
                for(int i=0;i<parts.length;i++)parts[i]=render(parts[i],lang,depth+1);
                return String.join(delimiter,parts);
            }
        }
        String trimmed=source.trim();entry=words.get(trimmed);
        if(entry!=null&&!trimmed.isEmpty()) {
            int start=source.indexOf(trimmed);return source.substring(0,start)+entry[lang]+source.substring(start+trimmed.length());
        }
        return source;
    }
    private String staticText(String value,int lang) {
        String[] row=words.get(value);if(row!=null)return row[lang];
        StringBuilder out=new StringBuilder();int at=0;
        while(at<value.length()) {
            String found=null;
            for(String key:fragments)if(value.startsWith(key,at)&&wordBoundaries(value,at,key)){found=key;break;}
            if(found==null)out.append(value.charAt(at++));
            else {out.append(words.get(found)[lang]);at+=found.length();}
        }
        return out.toString();
    }
    private static boolean wordBoundaries(String value,int at,String key) {
        int end=at+key.length();
        return !(at>0&&Character.isLetterOrDigit(key.charAt(0))&&Character.isLetterOrDigit(value.charAt(at-1)))
            && !(end<value.length()&&Character.isLetterOrDigit(key.charAt(key.length()-1))&&Character.isLetterOrDigit(value.charAt(end)));
    }
    static String unescape(String value) {
        StringBuilder out=new StringBuilder();
        for(int i=0;i<value.length();i++) {
            char c=value.charAt(i);
            if(c=='\\'&&i+1<value.length()) {
                char next=value.charAt(++i);
                if(next=='n')out.append('\n');else if(next=='r')out.append('\r');else if(next=='t')out.append('\t');else if(next=='s')out.append(' ');else if(next=='\\')out.append('\\');else out.append('\\').append(next);
            } else out.append(c);
        }
        return out.toString();
    }
    private static final class Template {
        final List<String> parts=new ArrayList<>();final int specificity;final String canonical;
        boolean singleLine;
        @SuppressWarnings("unchecked") final List<String>[] translated=new List[3];
        Template(String raw) throws IOException {
            canonical=raw;
            // FIX: Android ICU requires both literal braces to be escaped (unlike the host JVM).
            Matcher token=Pattern.compile("\\{[0-9]+\\}").matcher(raw);int end=0,score=0,count=0;
            while(token.find()) {
                String literal=raw.substring(end,token.start());parts.add(literal);score+=literal.length();
                end=token.end();count++;
            }
            String last=raw.substring(end);parts.add(last);score+=last.length();
            if(count==0||score<3)throw new IOException("Invalid UI template");
            specificity=score;
        }
        // FIX: bounded forward matching avoids regex backtracking freezing a scanner on long errors.
        List<String> match(String source) {
            if(singleLine&&source.indexOf('\n')>=0)return null;
            String first=parts.get(0),last=parts.get(parts.size()-1);
            if(!source.startsWith(first)||!source.endsWith(last)||source.length()<specificity)return null;
            int at=first.length(),lastAt=source.length()-last.length();
            List<String> captures=new ArrayList<>();
            for(int i=1;i<parts.size()-1;i++) {
                String part=parts.get(i);int next=source.indexOf(part,at);
                if(next<at||next+part.length()>lastAt)return null;
                captures.add(source.substring(at,next));at=next+part.length();
            }
            if(lastAt<at)return null;
            captures.add(source.substring(at,lastAt));return captures;
        }
    }
}

"""Import print artwork into a game-only texture folder; no source SVG modifications."""
from pathlib import Path
import unreal
root=Path(__file__).resolve().parent/'output'/'cards'
files=sorted(root.glob('*.png'))
assert len(files)==37
for path in files:
    task=unreal.AssetImportTask()
    task.filename=str(path);task.destination_path='/Game/Cards'
    task.destination_name='T_'+path.stem
    task.automated=True;task.replace_existing=True;task.save=True
    unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
    texture=unreal.load_asset('/Game/Cards/T_'+path.stem)
    assert isinstance(texture,unreal.Texture2D)
    texture.set_editor_property('lod_group',unreal.TextureGroup.TEXTUREGROUP_UI)
    texture.set_editor_property('mip_gen_settings',unreal.TextureMipGenSettings.TMGS_NO_MIPMAPS)
    texture.set_editor_property('srgb',True)
    unreal.EditorAssetLibrary.save_loaded_asset(texture)
print('PRINTED_CARDS_IMPORTED',len(files))

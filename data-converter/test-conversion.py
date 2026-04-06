import MaxPlus
import os
import os.path

import pymxs
rt = pymxs.runtime

def convertAllToMeshes(n, indent=''):
	objName = n.GetActualINode().Name
	if "Line" in objName:
		n.Convert(MaxPlus.ClassIds.PolyMeshObject)
	for c in n.Children:
		convertAllToMeshes(c, indent + '--')

convertAllToMeshes(MaxPlus.Core.GetRootNode())

folder = "PATH_TO_DIR"

fm = MaxPlus.FileManager

for dirpath, dirnames, filenames in os.walk(folder):
    for filename in [f for f in filenames if f.endswith(".max")]:
		fullPath = os.path.join(dirpath, filename)
		fullPathFBX = os.path.join(dirpath, filename) + ".fbx"
		fm.Open(fullPath)
		fm.Export(fullPathFBX)

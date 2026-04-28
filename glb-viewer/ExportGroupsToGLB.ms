/*

  CoronaVrayToGLB
  Author  : A-Star Group
  Website : https://a-star.group/
  Software: 3D Studio Max 2024+
  Engine  : V-Ray 6+, Corona 11+
  Language: MAXScript

  Version History
  ---------------

  v01  2025/04/24  All coordinates pre-converted to Three.js space at export time
                   No conversion needed in Three.js at runtime
                   Polygon/wall points: Max(x,y) -> Three.js(x,-y)
                     Max Y (forward) maps to Three.js -Z (stored as second component)
                   Object position:    Max(x,y,z) -> Three.js(x,z,-y)
                     Max Z (up) maps to Three.js Y
                     Max Y (forward) maps to Three.js -Z
                   Object size:        Max(x,y,z) -> Three.js(x,z,y)
                     Swap Y and Z so size axes match Three.js orientation
                   Object rotation: unchanged (already Three.js quaternion since v05)

*/

macroscript CoronaVrayToGLB
category:"A-Star"
tooltip:"Automate CoronaVrayToGLB"
buttonText:"Vray Corona To GLB"
Icon:"MassFX\CreateHingeConstraint"
(

  --------------------------------------------------------------------------
  -- Global Variables
  --------------------------------------------------------------------------

  scriptVersion          = "1.0"
  renderEngine           = ""
  testMode               = false
  findTextures           = false
  renameGltfMaps         = true
  hideWarningPopups      = false
  exportSelectedObjs     = true
  removeGlbLogFile       = true
  convertGlbCompliant    = true
  convertGlossinessMaps  = true
  convertSelectedMaterials = true
  glassToTransmission    = false
  theTarget              = rootnode
  missingTex             = #()

  currentMaxVersion      = maxVersion()
  defaultExportDirectory = @"C:\Users\" + sysInfo.username + @"\Documents\3ds Max " + (currentMaxVersion[8] as string) + @"\export\"
  if not doesFileExist defaultExportDirectory do makeDir defaultExportDirectory

  savedSettings = getDir(#userScripts) + "\\Vella\\CoronaVrayToGLB_Settings.txt"

  --------------------------------------------------------------------------
  -- 3ds Max settings
  --------------------------------------------------------------------------

  animButtonState = false

  --------------------------------------------------------------------------
  -- Utility: Sanitize filename
  --------------------------------------------------------------------------

  fn SanitizeFilename inputName =
  (
    local source = ""
    if inputName != undefined do source = inputName as string
    if source == "" do source = "Unnamed"
    local allowed = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_ ()[]{}.'"
    local result  = ""
    for i = 1 to source.count do
    (
      local ch = substring source i 1
      if findString allowed ch != undefined then result += ch else result += "_"
    )
    while (result.count > 0 and
           (substring result result.count 1 == " " or
            substring result result.count 1 == "." or
            substring result result.count 1 == "_")) do
    (
      if result.count > 1 then result = substring result 1 (result.count - 1) else result = ""
    )
    while (result.count > 0 and substring result 1 1 == "_") do result = substring result 2 (result.count - 1)
    if result == "" do result = "Unnamed"
    result
  )

  --------------------------------------------------------------------------
  -- Utility: Color helpers
  --------------------------------------------------------------------------

  fn ColorComponentToHex component =
  (
    local h = bit.intAsHex (amax 0 (amin 255 component))
    if h.count == 1 do h = "0" + h
    h
  )

  fn ColorToHex clr =
  (
    "#" + (ColorComponentToHex clr.r) + (ColorComponentToHex clr.g) + (ColorComponentToHex clr.b)
  )

  fn GetMaterialColor nodeArray =
  (
    for n in nodeArray where (superClassOf n == GeometryClass) and (n.material != undefined) do
    (
      local mat = n.material
      if classOf mat == Multimaterial and mat.numsubs > 0 do mat = mat[1]
      if (matchPattern (classOf mat as string) pattern:"CoronaPhysicalMtl*") do return (ColorToHex mat.baseColor)
      if (matchPattern (classOf mat as string) pattern:"VRayMtl*")           do return (ColorToHex mat.Diffuse)
      if (matchPattern (classOf mat as string) pattern:"glTFMaterial*")      do return (ColorToHex mat.baseColor)
      if classOf mat == StandardMaterial  do return (ColorToHex mat.diffuse)
      if classOf mat == PhysicalMaterial  do return (ColorToHex mat.base_color)
    )
    return (ColorToHex nodeArray[1].wirecolor)
  )

  --------------------------------------------------------------------------
  -- Utility: JSON string escape
  --------------------------------------------------------------------------

  fn EscapeJsonString str =
  (
    str = substituteString str "\\" "\\\\"
    str = substituteString str "\"" "\\\""
    str = substituteString str "\n" "\\n"
    str = substituteString str "\r" "\\r"
    str = substituteString str "\t" "\\t"
    str
  )

  --------------------------------------------------------------------------
  -- Rotation: 3ds Max (Z-up, LH) -> Three.js (Y-up, RH)
  --
  -- Step 1  flip handedness LH->RH : negate x,y,z  keep w
  -- Step 2  remap Z-up->Y-up       : (qx,qy,qz) -> (qx, qz, -qy)
  -- Combined                       : Max(x,y,z,w) -> Three.js(-x,-z,y,w)
  -- Then normalize.
  --------------------------------------------------------------------------

  fn ConvertRotationToThreeJS q =
  (
    local rx =  -q.x
    local ry =  -q.z
    local rz =   q.y
    local rw =   q.w
    local len = sqrt (rx*rx + ry*ry + rz*rz + rw*rw)
    if len > 0.0 do
    (
      rx = rx / len;  ry = ry / len;  rz = rz / len;  rw = rw / len
    )
    quat rx ry rz rw
  )

  fn GetObjectRotationYUp objArray =
  (
    if classof objArray != Array then objArray = #(objArray)
    local q     = quat 0 0 0 1
    local found = false
    for obj in objArray while not found do
      if isGroupHead obj then ( q = obj.rotation; found = true )
    if not found do
      for obj in objArray while not found do
        if isValidNode obj and (superClassOf obj == GeometryClass) then
          ( q = obj.rotation; found = true )
    ConvertRotationToThreeJS q
  )

  --------------------------------------------------------------------------
  -- Bounding box / position helpers
  --------------------------------------------------------------------------

  fn GetBoundingBoxSize objArray =
  (
    if classof objArray != Array then objArray = #(objArray)
    local minPt = [ 1e9,  1e9,  1e9]
    local maxPt = [-1e9, -1e9, -1e9]
    for obj in objArray do
    (
      if isValidNode obj and (superClassOf obj == GeometryClass) then
      (
        local bb = nodeGetBoundingBox obj (matrix3 1)
        if bb[1].x < minPt.x do minPt.x = bb[1].x
        if bb[1].y < minPt.y do minPt.y = bb[1].y
        if bb[1].z < minPt.z do minPt.z = bb[1].z
        if bb[2].x > maxPt.x do maxPt.x = bb[2].x
        if bb[2].y > maxPt.y do maxPt.y = bb[2].y
        if bb[2].z > maxPt.z do maxPt.z = bb[2].z
      )
    )
    #( (maxPt.x - minPt.x), (maxPt.y - minPt.y), (maxPt.z - minPt.z) )
  )

  fn GetObjectPosition objArray =
  (
    if classof objArray != Array then objArray = #(objArray)
    if objArray.count == 1 then return objArray[1].pos
    local found  = false
    local result = [0,0,0]
    for obj in objArray while not found do
      if isGroupHead obj then ( result = obj.pos; found = true )
    if found then return result
    local minPt = [ 1e9,  1e9,  1e9]
    local maxPt = [-1e9, -1e9, -1e9]
    for obj in objArray do
    (
      if isValidNode obj and (superClassOf obj == GeometryClass) then
      (
        local bb = nodeGetBoundingBox obj (matrix3 1)
        if bb[1].x < minPt.x do minPt.x = bb[1].x
        if bb[1].y < minPt.y do minPt.y = bb[1].y
        if bb[1].z < minPt.z do minPt.z = bb[1].z
        if bb[2].x > maxPt.x do maxPt.x = bb[2].x
        if bb[2].y > maxPt.y do maxPt.y = bb[2].y
        if bb[2].z > maxPt.z do maxPt.z = bb[2].z
      )
    )
    (minPt + maxPt) / 2.0
  )

  --------------------------------------------------------------------------
  -- Build metadata record for one exported GLB
  --
  -- Record layout:
  --  [1]  id           [2]  name         [3]  category
  --  [4]  type         [5]  size.x       [6]  size.y
  --  [7]  size.z       [8]  placementType[9]  color
  --  [10] modelUrl     [11] position.x   [12] position.y
  --  [13] position.z   [14] rotation.x   [15] rotation.y
  --  [16] rotation.z   [17] rotation.w
  --------------------------------------------------------------------------

  fn BuildExportMetadataRecord objectNode exportedName sizeArray positionValue rotationValue nodeArray =
  (
    local objName  = objectNode.name
    local objId    = substituteString (SanitizeFilename objName) " " "-"
    local objColor = GetMaterialColor nodeArray
    local modelUrl = "/models/" + exportedName

    -- Convert position from Max space to Three.js space:
    --   Max(x, y, z)  ->  Three.js(x, z, -y)
    --   Max Z (up)    ->  Three.js Y
    --   Max Y (fwd)   ->  Three.js -Z
    local posX =  positionValue.x
    local posY =  positionValue.z   -- Max Z  -> Three.js Y
    local posZ = -positionValue.y   -- Max Y  -> Three.js -Z

    -- Convert size axis order from Max space to Three.js space:
    --   Max(x, y, z)  ->  Three.js(x, z, y)
    --   width stays X, depth (Max Y) becomes Three.js Z, height (Max Z) becomes Three.js Y
    local sizeX = sizeArray[1]      -- Max X  -> Three.js X  (width,  unchanged)
    local sizeY = sizeArray[3]      -- Max Z  -> Three.js Y  (height)
    local sizeZ = sizeArray[2]      -- Max Y  -> Three.js Z  (depth)

    #(objId, objName, "other", "model",
      sizeX, sizeY, sizeZ,
      "floor", objColor, modelUrl,
      posX, posY, posZ,
      rotationValue.x, rotationValue.y, rotationValue.z, rotationValue.w)
  )

  --------------------------------------------------------------------------
  -- Find Missing Bitmaps
  --------------------------------------------------------------------------

  fn RepathFoundAssets =
  (
    local missingATSFiles = #()
    enumerateFiles (fn getNames name a = appendIfUnique a name) missingATSFiles #missing
    for i in missingATSFiles do
      appendIfUnique missingTex (getFilenameFile i + ": File Missing. Check Asset Tracker.")

    local allFiles   = for b in (getClassInstances Bitmaptexture) collect b.filename
    local foundFiles = for f in allFiles where not (findItem missingATSFiles f > 0) collect f
    for i in foundFiles where (foundFiles.count > 0) do
    (
      ATSOps.SelectFiles i
      ATSOps.ResolveSelectionToAbsolute()
    )
  )

  fn FindMissingTextures currentMaterial textureType =
  (
    local locatedBitmap = undefined
    for foundBitmap in (getClassInstances Bitmaptexture target:currentMaterial) do
    (
      if doesFileExist foundBitmap.filename then ( locatedBitmap = copy foundBitmap; exit )
    )
    if locatedBitmap == undefined then return undefined

    local wordsToRemove  = #("diff","base","basecolor","color","bcolor","albe","alph","opac","metal","rough","ao","occlus","ambient","emis","self","illum","norm","sheen")
    local bitmapDir      = getFilenamePath locatedBitmap.bitmap.filename
    local bitmapName     = getFilenameFile  locatedBitmap.bitmap.filename
    local bitmapExt      = getFilenameType  locatedBitmap.bitmap.filename

    local regexPattern = "[-_]("
    for i = 1 to wordsToRemove.count do
    (
      regexPattern += wordsToRemove[i] + ".*"
      if i < wordsToRemove.count do regexPattern += "|"
    )
    regexPattern += ")$"
    local regexReplace = dotNetObject "System.Text.RegularExpressions.Regex" regexPattern \
                         (dotNetClass "System.Text.RegularExpressions.RegexOptions").IgnoreCase
    local cleanedName  = regexReplace.Replace bitmapName ""

    local allBitmapsInDir = #()
    for f in getFiles (bitmapDir + "*.*") do append allBitmapsInDir (getFilenameFile f)

    local wordsToFind = #()
    case textureType of
    (
      "Diffuse"           : wordsToFind = #("diff","base","basecolor","color","bcolor","albe")
      "Alpha"             : wordsToFind = #("alph","opac")
      "Metal"             : wordsToFind = #("metal")
      "Roughness"         : wordsToFind = #("rough")
      "Occlusion"         : wordsToFind = #("ao","occlus","ambient")
      "Emission"          : wordsToFind = #("emis","self","illum")
      "Normal"            : wordsToFind = #("norm")
      "Sheen"             : wordsToFind = #("sheen")
      "SheenRoughness"    : wordsToFind = #("sheen_r","sheen r","sheen-r","sheenr")
      "ClearCoat"         : wordsToFind = #("clear","coat","clearcoat")
      "ClearCoatRoughness": wordsToFind = #("clear-r","clear_r","clear r","coat-r","coat_r","clearcoat_r")
      "ClearCoatNormal"   : wordsToFind = #("clear-n","clear_n","coat-n","coat_n","clearcoat-n","clearcoat_n")
    )

    for bName in allBitmapsInDir do
    (
      for word in wordsToFind do
      (
        local rp = cleanedName + "[-_](" + word + ".*)$"
        local rs = dotNetObject "System.Text.RegularExpressions.Regex" rp \
                   (dotNetClass "System.Text.RegularExpressions.RegexOptions").IgnoreCase
        if rs.IsMatch(bName) then
        (
          locatedBitmap.filename = (bitmapDir + bName + bitmapExt)
          return locatedBitmap
        )
      )
    )
    undefined
  )

  fn SearchBitmapNodes currentMaterial bitmapNode textureType =
  (
    local locatedBitmap = undefined
    if bitmapNode != undefined then
      for foundBitmap in (getClassInstances Bitmaptexture target:bitmapNode) do
        ( locatedBitmap = foundBitmap; return foundBitmap )

    if (locatedBitmap == undefined) or (classof locatedBitmap != Bitmaptexture) then
    (
      locatedBitmap = FindMissingTextures currentMaterial textureType
      if locatedBitmap != undefined then return locatedBitmap
      else
        if (bitmapNode != alphaNode) or (bitmapNode != emissionNode) or
           (bitmapNode != sheenNode) or (bitmapNode != sheenRoughNode) or
           (bitmapNode != clearCoatNode) or (bitmapNode != clearCoatRoughNode) or
           (bitmapNode != clearCoatNormalNode) then
          appendIfUnique missingTex (currentMaterial.name + " - Missing: " + textureType + " Texture")
    )
    undefined
  )

  --------------------------------------------------------------------------
  -- Color / value conversion helpers
  --------------------------------------------------------------------------

  fn InvertValue val          = ( 1.0 - val )
  fn MapToUnitRange val       = ( val / 255.0 )

  fn RemapHDRtoRGB colorHdr cSpace =
  (
    local r = if colorHdr[1] > 1.0 then 1.0 else colorHdr[1]
    local g = if colorHdr[2] > 1.0 then 1.0 else colorHdr[2]
    local b = if colorHdr[3] > 1.0 then 1.0 else colorHdr[3]
    if cSpace == 0 then
      color (pow r 2.2 * 255.0) (pow g 2.2 * 255.0) (pow b 2.2 * 255.0)
    else
      color (r * 255.0) (g * 255.0) (b * 255.0)
  )

  fn KelvinToRGB tempKelvin =
  (
    local t  = tempKelvin / 100.0
    local r  = if t <= 66.0 then 255 else (329.698727446 * ((t-60)^-0.1332047592))
    local g  = if t <= 66.0 then ((99.4708025861 * log t) - 161.1195681661) else (288.1221695283 * ((t-60)^-0.0755148492))
    local bl = if t <= 19.0 then 0 else if t >= 66.0 then 255 else ((138.5177312231 * log (t-10)) - 305.0447927307)
    color (amax (amin r 255) 0) (amax (amin g 255) 0) (amax (amin bl 255) 0)
  )

  fn HexToRGB hexColor =
  (
    hexColor   = substituteString hexColor "#" ""
    local r    = (execute ("0x" + (substring hexColor 1 2))) as float / 255.0
    local g    = (execute ("0x" + (substring hexColor 3 2))) as float / 255.0
    local b    = (execute ("0x" + (substring hexColor 5 2))) as float / 255.0
    color (pow r 2.2 * 255.0) (pow g 2.2 * 255.0) (pow b 2.2 * 255.0)
  )

  fn ApplyGammaToColors colorValue gammaValue =
  (
    color (255.0 * ((colorValue.r/255.0)^gammaValue))
          (255.0 * ((colorValue.g/255.0)^gammaValue))
          (255.0 * ((colorValue.b/255.0)^gammaValue))
  )

  fn ConvertColorNodes bitmapNode =
  (
    if bitmapNode == undefined then return undefined
    if renderEngine == "Vray" then
      for n in (getClassInstances VRayColor target:bitmapNode) do
        return (if n.color_gamma == 1.0 then n.color else ApplyGammaToColors n.color n.color_gamma)
    if renderEngine == "Corona" then
      for n in (getClassInstances CoronaColor target:bitmapNode) do
      (
        if n.method == 0 then return n.color
        if n.method == 1 then return RemapHDRtoRGB n.colorHdr n.colorSpace
        if n.method == 2 then return KelvinToRGB n.temperature
        if n.method == 3 then return HexToRGB n.hexColor
      )
    undefined
  )

  --------------------------------------------------------------------------
  -- Material conversion helpers
  --------------------------------------------------------------------------

  fn ConvertBitmapToJpg currentBitmap =
  (
    local filename       = currentBitmap.filename
    local ext      = getFilenameType filename
    local okTypes  = #(".jpg",".jpeg",".png")
    if findItem okTypes ext == 0 do
    (
      try(local orig = openBitmap filename)catch()
      if (orig != undefined and isKindOf orig bitmap) then
      (
        local newFn = getFilenamePath filename + getFilenameFile filename + ".jpg"
        if doesFileExist newFn then
          currentBitmap.filename = newFn
        else
        (
          print ("Converting Non-Compliant GLB Texture: " + (filenameFromPath filename))
          local nb = bitmap orig.width orig.height
          pasteBitmap orig nb [0,0] [0,0]
          nb.filename = newFn
          save nb; close nb; close orig
          currentBitmap.filename = nb.filename
          free nb; free orig
        )
      )
    )
  )

  fn InvertGlossinessTextures glossMap =
  (
    local invFn = getFilenamePath glossMap + getFilenameFile glossMap + "_inverted" + getFilenameType glossMap
    if doesFileExist invFn then return invFn
    print ("Converting Glossiness Texture: " + (filenameFromPath glossMap))
    try(local orig = openBitmap glossMap)catch()
    if (orig != undefined and isKindOf orig bitmap) then
    (
      local inv = copy orig
      for y = 0 to (inv.height - 1) do
      (
        local px = getPixels inv [0,y] inv.width
        for i = 1 to px.count do px[i] = color (255-px[i].r) (255-px[i].g) (255-px[i].b)
        setPixels inv [0,y] px
      )
      inv.filename = invFn
      save inv; close inv; close orig; free inv; free orig
      return invFn
    )
    undefined
  )

  fn ReplaceGLTFBitmap materialName materialMap bitmapNode bitmapType gammaValue gltfCompliant =
  (
    if bitmapNode != undefined then
      for foundBitmap in (getClassInstances Bitmaptexture target:bitmapNode) do
      (
        materialMap = foundBitmap
        if doesFileExist materialMap.filename do
          materialMap.bitmap = openBitmap materialMap.filename gamma:gammaValue
        if materialMap != undefined then return materialMap
      )
    if (materialMap == undefined) and (gltfCompliant == "Required") then
    (
      appendIfUnique missingTex (materialName + " - Missing: " + bitmapType + " Texture")
      return undefined
    )
    undefined
  )

  --------------------------------------------------------------------------
  -- Core: Convert one Corona/Vray material to glTF
  --------------------------------------------------------------------------

  fn ConvertToGltf currentMaterial =
  (
    RepathFoundAssets()

    local newMaterial = undefined
    ( if isKindOf (gltfMat = execute "glTFMaterial") Material do (newMaterial = gltfMat()) )
    if newMaterial == undefined then
    (
      messageBox ("Your 3ds Max version does not support GLTF.\n3ds Max 2023+ Required.")
      return undefined
    )
    newMaterial.name = currentMaterial.name

    -- Gather engine-specific slots
    local diffuseNode           = undefined
    local diffuseColor          = undefined
    local roughNode             = undefined
    local roughValue            = 0.0
    local roughBrdf             = false
    local bumpNode              = undefined
    local normalNode            = undefined
    local metalNode             = undefined
    local metalValue            = 0.0
    local alphaNode             = undefined
    local emissionNode          = undefined
    local emissionValue         = 0.0
    local emissionColor         = (color 0 0 0)
    local sheenNode             = undefined
    local sheenValue            = 0.0
    local sheenColor            = (color 0 0 0)
    local sheenRoughNode        = undefined
    local sheenRoughValue       = 0.0
    local clearCoatNode         = undefined
    local clearCoatValue        = 0.0
    local clearCoatRoughNode    = undefined
    local clearCoatRoughValue   = 0.0
    local clearCoatBumpNode     = undefined
    local clearCoatNormalNode   = undefined
    local clearCoatNormalValue  = 0.0
    local transmissionNode      = undefined
    local transmissionValue     = 0.0
    local transmissionRoughValue= 0.0
    local occlusionNode         = undefined

    if renderEngine == "Corona" then
    (
      diffuseNode          = currentMaterial.baseTexmap
      diffuseColor         = currentMaterial.baseColor
      roughNode            = currentMaterial.baseRoughnessTexmap
      roughValue           = currentMaterial.baseRoughness
      roughBrdf            = (currentMaterial.roughnessMode == 0)
      bumpNode             = currentMaterial.baseBumpTexmap
      try(normalNode       = currentMaterial.baseBumpTexmap.normalMap)catch()
      metalNode            = currentMaterial.metalnessTexmap
      metalValue           = currentMaterial.metalnessMode
      alphaNode            = currentMaterial.opacityTexmap
      emissionNode         = currentMaterial.selfIllumTexmap
      emissionValue        = currentMaterial.selfIllumLevel
      emissionColor        = currentMaterial.selfIllumColor
      sheenNode            = currentMaterial.sheenColorTexmap
      sheenValue           = currentMaterial.sheenAmount
      sheenColor           = currentMaterial.sheenColor
      sheenRoughNode       = currentMaterial.sheenRoughnessTexmap
      sheenRoughValue      = currentMaterial.sheenRoughness
      clearCoatNode        = currentMaterial.clearcoatAmountTexmap
      clearCoatValue       = currentMaterial.clearcoatAmount
      clearCoatRoughNode   = currentMaterial.clearcoatRoughnessTexmap
      clearCoatRoughValue  = currentMaterial.clearcoatRoughness
      clearCoatBumpNode    = currentMaterial.clearcoatBumpTexmap
      try(clearCoatNormalNode = currentMaterial.clearcoatBumpTexmap.normalMap)catch()
      clearCoatNormalValue = currentMaterial.clearcoatBumpMapAmount
      transmissionNode     = currentMaterial.refractionAmountTexmap
      transmissionValue    = currentMaterial.refractionAmount
      transmissionRoughValue = currentMaterial.baseRoughness
    )

    if renderEngine == "Vray" then
    (
      diffuseNode          = currentMaterial.texmap_diffuse
      diffuseColor         = currentMaterial.Diffuse
      roughNode            = currentMaterial.texmap_reflectionGlossiness
      roughValue           = currentMaterial.reflection_glossiness
      roughBrdf            = currentMaterial.brdf_useRoughness
      bumpNode             = currentMaterial.texmap_bump
      try(normalNode       = currentMaterial.texmap_bump.normal_map)catch()
      metalNode            = currentMaterial.texmap_metalness
      metalValue           = currentMaterial.reflection_metalness
      alphaNode            = currentMaterial.texmap_opacity
      emissionNode         = currentMaterial.texmap_self_illumination
      emissionValue        = currentMaterial.selfIllumination_multiplier
      emissionColor        = currentMaterial.selfIllumination
      sheenNode            = currentMaterial.texmap_sheen
      sheenColor           = currentMaterial.sheen_color
      sheenRoughNode       = currentMaterial.texmap_sheen_glossiness
      sheenRoughValue      = currentMaterial.sheen_glossiness
      clearCoatNode        = currentMaterial.texmap_coat_amount
      clearCoatValue       = currentMaterial.coat_amount
      clearCoatRoughNode   = currentMaterial.texmap_coat_glossiness
      clearCoatRoughValue  = currentMaterial.coat_glossiness
      clearCoatBumpNode    = currentMaterial.texmap_coat_bump
      try(clearCoatNormalNode = currentMaterial.texmap_coat_bump.normal_map)catch()
      clearCoatNormalValue = currentMaterial.texmap_coat_bump_multiplier
      transmissionNode     = currentMaterial.texmap_refraction
      transmissionValue    = MapToUnitRange currentMaterial.Refraction.value
      transmissionRoughValue = currentMaterial.refraction_glossiness
    )

    -- Optional texture search
    if findTextures == true then
    (
      local fd = SearchBitmapNodes currentMaterial diffuseNode "Diffuse"
      if fd != undefined do diffuseNode = fd
      local fr = SearchBitmapNodes currentMaterial roughNode "Roughness"
      if fr != undefined do roughNode = fr
      local fm = SearchBitmapNodes currentMaterial metalNode "Metal"
      if fm != undefined do metalNode = fm
      local fe = SearchBitmapNodes currentMaterial emissionNode "Emission"
      if fe != undefined do emissionNode = fe
      local fo = SearchBitmapNodes currentMaterial occlusionNode "Occlusion"
      if fo != undefined do occlusionNode = fo
      local fn2 = SearchBitmapNodes currentMaterial normalNode "Normal"
      if fn2 != undefined do normalNode = fn2
      local fa = SearchBitmapNodes currentMaterial alphaNode "Alpha"
      if fa != undefined do alphaNode = fa
      local fs = SearchBitmapNodes currentMaterial sheenNode "Sheen"
      if fs != undefined do sheenNode = fs
      local fsr = SearchBitmapNodes currentMaterial sheenRoughNode "SheenRoughness"
      if fsr != undefined do sheenRoughNode = fsr
      local fcc = SearchBitmapNodes currentMaterial clearCoatNode "ClearCoat"
      if fcc != undefined do clearCoatNode = fcc
      local fccr = SearchBitmapNodes currentMaterial clearCoatRoughNode "ClearCoatRoughness"
      if fccr != undefined do clearCoatRoughNode = fccr
      local fccn = SearchBitmapNodes currentMaterial clearCoatNormalNode "ClearCoatNormal"
      if fccn != undefined do clearCoatNormalNode = fccn
    )

    -- Glossiness -> Roughness BRDF flip
    if renderEngine == "Vray" and roughBrdf == false then
    (
      roughValue          = InvertValue roughValue
      sheenRoughValue     = InvertValue sheenRoughValue
      clearCoatRoughValue = InvertValue clearCoatRoughValue
    )

    -- Diffuse
    local gltfDiffuse = ReplaceGLTFBitmap newMaterial.name newMaterial.baseColorMap diffuseNode "Diffuse" 2.2 "Required"
    if gltfDiffuse != undefined then
      newMaterial.baseColorMap = gltfDiffuse
    else if isKindOf diffuseColor color then
    (
      local cn = ConvertColorNodes diffuseNode
      newMaterial.baseColor = if cn != undefined then cn else diffuseColor
    )

    -- Roughness
    local gltfRough = ReplaceGLTFBitmap newMaterial.name newMaterial.roughnessMap roughNode "Roughness" 1.0 "Required"
    if gltfRough != undefined then
      newMaterial.roughnessMap = gltfRough
    else if roughValue != undefined do
      newMaterial.roughness = roughValue

    if convertGlossinessMaps and roughBrdf == false and gltfRough != undefined then
    (
      local invPath = InvertGlossinessTextures gltfRough.filename
      if invPath != undefined do newMaterial.roughnessMap.filename = invPath
    )

    -- Metalness
    local gltfMetal = ReplaceGLTFBitmap newMaterial.name newMaterial.metalnessMap metalNode "Metalness" 1.0 "Required"
    if gltfMetal != undefined then
      newMaterial.metalnessMap = gltfMetal
    else
    (
      if renderEngine == "Vray"   and metalValue > 0  do newMaterial.metalness = metalValue
      if renderEngine == "Corona" and metalValue == 1 do newMaterial.metalness = 1.0
    )

    -- Normal
    local gltfNormal = ReplaceGLTFBitmap newMaterial.name newMaterial.normalMap normalNode "Normal" 1.0 "Required"
    if gltfNormal != undefined then
      newMaterial.normalMap = gltfNormal
    else
    (
      local gltfBump = ReplaceGLTFBitmap newMaterial.name newMaterial.normalMap bumpNode "Bump" 1.0 "Optional"
      if gltfBump != undefined do newMaterial.normalMap = gltfBump
    )

    -- Occlusion
    local gltfOcc = ReplaceGLTFBitmap newMaterial.name newMaterial.ambientOcclusionMap occlusionNode "Occlusion" 1.0 "Required"
    if gltfOcc != undefined do newMaterial.ambientOcclusionMap = gltfOcc

    -- Emission
    local gltfEmit = ReplaceGLTFBitmap newMaterial.name newMaterial.emissionMap emissionNode "Emission" 2.2 "Optional"
    if gltfEmit != undefined then
      newMaterial.emissionMap = gltfEmit
    else
    (
      local cn = ConvertColorNodes emissionNode
      if cn != undefined then
        newMaterial.emissionColor = cn
      else
      (
        if renderEngine == "Vray"   and emissionColor != (color 0 0 0) do newMaterial.emissionColor = emissionColor
        if renderEngine == "Corona" and emissionValue > 0              do newMaterial.emissionColor = emissionColor
      )
    )

    -- Alpha
    local gltfAlpha = ReplaceGLTFBitmap newMaterial.name newMaterial.AlphaMap alphaNode "Alpha" 1.0 "Optional"
    if gltfAlpha != undefined then
    (
      newMaterial.AlphaMap   = gltfAlpha
      newMaterial.alphaMode  = 2
      newMaterial.alphaCutoff = 0.5
    )

    -- Sheen
    local gltfSheen = ReplaceGLTFBitmap newMaterial.name newMaterial.sheenColorMap sheenNode "Sheen" 2.2 "Optional"
    if gltfSheen != undefined then
      ( newMaterial.enableSheen = on; newMaterial.sheenColorMap = gltfSheen )

    local gltfSheenR = ReplaceGLTFBitmap newMaterial.name newMaterial.sheenRoughnessMap sheenRoughNode "SheenRoughness" 1.0 "Optional"
    if gltfSheenR != undefined then
      ( newMaterial.enableSheen = on; newMaterial.sheenRoughnessMap = gltfSheenR )

    if renderEngine == "Vray" and sheenColor != (color 0 0 0) then
    (
      newMaterial.enableSheen = on; newMaterial.sheenColor = sheenColor
      if gltfSheenR == undefined do newMaterial.sheenRoughness = sheenRoughValue
    )
    if renderEngine == "Corona" and sheenValue > 0 then
    (
      if gltfSheen == undefined then
      (
        newMaterial.enableSheen = on; newMaterial.sheenColor = sheenColor
        if gltfSheenR == undefined do newMaterial.sheenRoughness = sheenRoughValue
      )
    )
    if gltfSheen == undefined then
    (
      local cn = ConvertColorNodes sheenNode
      if cn != undefined then ( newMaterial.enableSheen = on; newMaterial.sheenColor = cn )
    )

    -- ClearCoat
    local gltfCC = ReplaceGLTFBitmap newMaterial.name newMaterial.clearcoatMap clearCoatNode "ClearCoat" 2.2 "Optional"
    if gltfCC != undefined then
      ( newMaterial.enableClearCoat = on; newMaterial.clearcoatMap = gltfCC )
    else if clearCoatValue > 0 do
      ( newMaterial.enableClearCoat = on; newMaterial.clearcoat = clearCoatValue )

    local gltfCCR = ReplaceGLTFBitmap newMaterial.name newMaterial.clearcoatRoughnessMap clearCoatRoughNode "ClearCoatRoughness" 1.0 "Optional"
    if gltfCCR != undefined then
      ( newMaterial.enableClearCoat = on; newMaterial.clearcoatRoughnessMap = gltfCCR )
    else if clearCoatValue > 0 do
      ( newMaterial.enableClearCoat = on; newMaterial.clearcoatRoughness = clearCoatRoughValue )

    local gltfCCN = ReplaceGLTFBitmap newMaterial.name newMaterial.clearcoatNormalMap clearCoatNormalNode "ClearCoatNormal" 1.0 "Optional"
    if gltfCCN != undefined then
      ( newMaterial.enableClearCoat = on; newMaterial.clearcoatNormalMap = gltfCCN )
    else
    (
      local gltfCCB = ReplaceGLTFBitmap newMaterial.name newMaterial.clearcoatNormalMap clearCoatBumpNode "ClearCoatNormal" 1.0 "Optional"
      if gltfCCB != undefined do newMaterial.clearcoatNormalMap = gltfCCB
    )
    if newMaterial.enableClearCoat == on and newMaterial.clearcoatNormalMap != undefined then
    (
      if renderEngine == "Vray"   and clearCoatNormalValue != 30.0 do newMaterial.clearcoatNormal = clearCoatNormalValue / 100.0
      if renderEngine == "Corona" and clearCoatNormalValue != 1.0  do newMaterial.clearcoatNormal = clearCoatNormalValue
    )

    -- Transmission
    if glassToTransmission == true then
    (
      if transmissionValue > 0 or (renderEngine == "Corona" and currentMaterial.useThinMode == true) then
      (
        newMaterial.enableTransmission = on
        newMaterial.transmission = transmissionValue
        local gltfTrans = ReplaceGLTFBitmap newMaterial.name newMaterial.transmissionMap transmissionNode "Transmission" 1.0 "Optional"
        if gltfTrans != undefined then
          ( newMaterial.enableTransmission = on; newMaterial.transmissionMap = gltfTrans )

        if newMaterial.roughnessMap == undefined then
        (
          if renderEngine == "Vray" then
          (
            if transmissionRoughValue != 1 then
            (
              if roughBrdf == false do transmissionRoughValue = InvertValue transmissionRoughValue
              newMaterial.roughness = transmissionRoughValue
            )
            if transmissionRoughValue == 1 and roughValue != 1 do newMaterial.roughness = roughValue
          )
          if renderEngine == "Corona" and transmissionRoughValue != 0 do newMaterial.roughness = transmissionRoughValue
        )

        -- Volume
        if renderEngine == "Vray" and currentMaterial.refraction_fogDepth > 0 then
        (
          newMaterial.enableVolume   = on
          newMaterial.volumeThickness = 1
          newMaterial.volumeDistance  = 1
          newMaterial.volumeColor     = currentMaterial.refraction_fogColor
          local gltfVT = ReplaceGLTFBitmap newMaterial.name newMaterial.volumeThicknessMap currentMaterial.texmap_refraction_fog_depth "transmissionVolumeThickMap" 1.0 "Optional"
          if gltfVT != undefined do newMaterial.volumeThicknessMap = gltfVT
          if currentMaterial.texmap_refraction_fog != undefined then
          (
            local cn = ConvertColorNodes currentMaterial.texmap_refraction_fog
            if cn != undefined do newMaterial.volumeColor = cn
          )
        )

        if renderEngine == "Corona" then
        (
          if currentMaterial.attenuationDistance > 0 and currentMaterial.useThinMode == false then
          (
            newMaterial.enableVolume    = on
            newMaterial.volumeThickness = 1
            newMaterial.volumeDistance  = 1
            newMaterial.volumeColor     = currentMaterial.volumetricScatteringColor
            if currentMaterial.volumetricScatteringTexmap != undefined then
            (
              local cn = ConvertColorNodes currentMaterial.volumetricScatteringTexmap
              if cn != undefined do newMaterial.volumeColor = cn
            )
          )
          if currentMaterial.useThinMode == on and currentMaterial.translucencyFraction > 0 then
          (
            newMaterial.enableVolume    = on
            newMaterial.volumeThickness = 1
            newMaterial.volumeDistance  = 1
            newMaterial.volumeColor     = currentMaterial.translucencyColor
            newMaterial.transmission    = currentMaterial.translucencyFraction
          )
          if currentMaterial.useThinMode == on and (currentMaterial.refractionAmount == 1 or transmissionNode != undefined) then
          (
            newMaterial.enableVolume    = on
            newMaterial.volumeThickness = 1
            newMaterial.volumeDistance  = 1
            newMaterial.volumeColor     = currentMaterial.thinAbsorptionColor
            newMaterial.transmission    = 1
          )
        )

        -- Glass assumptions
        if renderEngine == "Vray" then
          if gltfDiffuse == undefined and diffuseColor.value < 45.0 and currentMaterial.Reflection.value > 125.0 and transmissionValue > 0.8 do
            newMaterial.baseColor = (color 255 255 255)
        if renderEngine == "Corona" then
          if gltfDiffuse == undefined and diffuseColor.value < 128.0 and transmissionValue > 0.8 do
            newMaterial.baseColor = (color 255 255 255)
      )
    )

    -- Rename GLTF maps
    if renameGltfMaps == true then
    (
      try(newMaterial.baseColorMap.name          = "Base Color")catch()
      try(newMaterial.roughnessMap.name           = "Roughness")catch()
      try(newMaterial.metalnessMap.name           = "Metalness")catch()
      try(newMaterial.AlphaMap.name               = "Alpha")catch()
      try(newMaterial.emissionMap.name            = "Emission")catch()
      try(newMaterial.ambientOcclusionMap.name    = "Occlusion")catch()
      try(newMaterial.normalMap.name              = "Normal")catch()
      try(newMaterial.sheenColorMap.name          = "Sheen")catch()
      try(newMaterial.sheenRoughnessMap.name      = "SheenRoughness")catch()
      try(newMaterial.clearcoatMap.name           = "ClearCoat")catch()
      try(newMaterial.clearcoatRoughnessMap.name  = "ClearCoatRoughness")catch()
      try(newMaterial.clearcoatNormalMap.name     = "ClearCoatNormal")catch()
      try(newMaterial.transmissionMap.name        = "Transmission")catch()
      try(newMaterial.volumeThicknessMap.name     = "VolumeThickness")catch()
    )

    -- Convert non-compliant bitmaps to jpg
    if convertGlbCompliant == true then
      for i in getClassInstances bitmaptexture target:newMaterial do
        if i != undefined do ConvertBitmapToJpg i

    newMaterial
  )

  --------------------------------------------------------------------------
  -- Vray conversion
  --------------------------------------------------------------------------

  fn ConvertVrayBitmaps =
  (
    for i in getClassInstances VRayBitmap target:theTarget do
      if i.HDRIMapName != undefined then
      (
        local nb = Bitmaptexture()
        nb.filename = i.HDRIMapName
        nb.name     = i.name
        replaceinstances i nb
      )
  )

  fn ConvertVrayMtls =
  (
    for i in getClassInstances VRayMtl target:theTarget do
    (
      local p = ConvertToGltf i
      if p != undefined do replaceInstances i p
    )
  )

  fn ConvertVrayClasses =
  (
    for i in material.classes do
      if matchPattern (i as string) pattern:"*Vray*" then
        for j in getClassInstances i do
          if isKindOf (gltfMat = execute "glTFMaterial") Material do
            for k in getClassInstances gltfMat target:j do replaceInstances j k
  )

  --------------------------------------------------------------------------
  -- Corona conversion
  --------------------------------------------------------------------------

  fn ConvertCoronaBitmaps =
  (
    for i in getClassInstances CoronaBitmap target:theTarget do
      if i != undefined then
      (
        local nb = Bitmaptexture()
        nb.filename = i.filename
        nb.name     = i.name
        replaceinstances i nb
      )
  )

  fn ConvertCoronaFrontSide =
  (
    for i in getClassInstances CoronaFrontBack target:theTarget do
      for j in getClassInstances Bitmaptexture target:i do replaceinstances i j
  )

  fn ConvertCoronaMtls =
  (
    for i in getClassInstances CoronaPhysicalMtl target:theTarget do
    (
      local p = ConvertToGltf i
      if p != undefined do replaceInstances i p
    )
  )

  fn ConvertCoronaClasses =
  (
    for i in material.classes do
      if matchPattern (i as string) pattern:"*Corona*" then
        for j in getClassInstances i do
          if isKindOf (gltfMat = execute "glTFMaterial") Material do
            for k in getClassInstances gltfMat target:j do replaceInstances j k
  )

  --------------------------------------------------------------------------
  -- Convert Materials (main dispatch)
  --------------------------------------------------------------------------

  fn ConvertCoronaVray =
  (
    if matchPattern (renderers.current as string) pattern:"*V_RAY*" then
    (
      renderEngine = "Vray"
      ConvertVrayBitmaps(); ConvertVrayMtls(); ConvertVrayClasses()
    )
    if matchPattern (renderers.current as string) pattern:"*Corona*" then
    (
      renderEngine = "Corona"
      ConvertCoronaBitmaps(); ConvertCoronaFrontSide(); ConvertCoronaMtls(); ConvertCoronaClasses()
    )
    ForceCompleteRedraw()
  )

  fn PrintMissingTextures =
  (
    if missingTex.count != 0 then
    (
      for i in missingTex do print i
      if hideWarningPopups == false do
        messageBox "Some materials are missing textures. Check the MAXScript Listener for details."
    )
    free missingTex
    ATSOps.Refresh()
  )

  --------------------------------------------------------------------------
  -- Remove Subdivision Modifiers
  --------------------------------------------------------------------------

  fn RemoveSubdivisions =
  (
    for obj in objects do
      for mod in obj.modifiers do
        if (mod.name == "OpenSubdiv" or mod.name == "TurboSmooth" or mod.name == "MeshSmooth") do
          deleteModifier obj mod
  )

  --------------------------------------------------------------------------
  -- Collapse Multi-Sub Materials
  --------------------------------------------------------------------------

  fn CountBitmapsFromMaterial mat =
  (
    local count = 0
    for x in getClassInstances bitmaptexture do
      for y in refs.dependents x where y == mat do count += 1
    count
  )

  fn CollapseMultiSubs =
  (
    for mat in getClassInstances MultiMaterial target:rootnode do
      for i = 1 to mat.numsubs do
        if mat[i] != undefined do mat[i] = copy mat[i]

    for mat in getClassInstances MultiMaterial target:rootnode do
    (
      local maxCount = 0;  local maxMat = undefined
      for i = 1 to mat.numsubs do
      (
        local c = CountBitmapsFromMaterial mat[i]
        if c > maxCount do ( maxCount = c; maxMat = mat[i] )
      )
      if maxMat != undefined do ( replaceInstances mat maxMat; maxMat.name = mat.name )
    )
  )

  --------------------------------------------------------------------------
  -- Export single GLB (legacy per-object export)
  --------------------------------------------------------------------------

  fn ExportToGLB glbPath textField obj isCombined =
  (
    local outFile   = ""
    local selOnly   = false
    if (obj != undefined) and (isCombined == false) then
      ( outFile = glbPath + (SanitizeFilename obj.name) + ".glb"; selOnly = true )
    else if (obj != undefined) and (isCombined == true) then
      ( if textField == "" do textField = "Unnamed"; outFile = glbPath + (SanitizeFilename textField) + ".glb"; selOnly = true )
    else
      ( if textField == "" do textField = "Unnamed"; outFile = glbPath + (SanitizeFilename textField) + ".glb" )
    exportFile outFile #noPrompt selectedOnly:selOnly using:GLTF_Export
    if removeGlbLogFile do deleteFile (outFile + ".log")
  )

  --------------------------------------------------------------------------
  -- Export nodes to one GLB file (used by groups export)
  --------------------------------------------------------------------------

  fn ExportNodesToGLB glbPath fileName nodeArray =
  (
    fileName = SanitizeFilename fileName
    if fileName == "" do fileName = "node_" + (nodeArray[1].inode.handle as string)
    if glbPath.count > 0 and (substring glbPath glbPath.count 1 != "\\") do glbPath += "\\"
    clearSelection()
    select nodeArray
    local outFile = glbPath + fileName + ".glb"
    exportFile outFile #noPrompt selectedOnly:true using:GLTF_Export
    if removeGlbLogFile do deleteFile (outFile + ".log")
    clearSelection()
    fileName + ".glb"
  )

  --------------------------------------------------------------------------
  -- Collect all nodes inside a group (recursive)
  --------------------------------------------------------------------------

  fn CollectGroupMembers groupHead =
  (
    local members = #(groupHead)
    for child in groupHead.children do
    (
      if isGroupHead child then join members (CollectGroupMembers child)
      else                      append members child
    )
    members
  )

  --------------------------------------------------------------------------
  -- Room Spline: extract polygon points (2D, top-down)
  --------------------------------------------------------------------------

  fn GetSplinePolygon splineObj =
  (
    -- Converts knot points from 3ds Max space to Three.js space at export time:
    --   Max X  ->  Three.js X  (unchanged)
    --   Max Y  ->  Three.js -Z (negated, stored as second component)
    -- This means Three.js can use polygon[i] as [x, z] directly with no runtime conversion.
    local pts = #()
    if (classOf splineObj == SplineShape) or (classOf splineObj == Line) then
    (
      local nk = numKnots splineObj 1
      for k = 1 to nk do
      (
        local kp = getKnotPoint splineObj 1 k
        append pts #(kp.x, -kp.y)   -- negate Y: Max forward -> Three.js -Z
      )
    )
    pts
  )

  --------------------------------------------------------------------------
  -- Room Spline: generate walls from segments
  --   - Reads per-wall overrides from user-properties on the spline:
  --       wallThickness  (default 0.2)
  --       wallHeight     (default 3.0)
  --       wallColor      (default #cccccc)
  --   - Closed splines wrap the last segment back to knot 1
  --------------------------------------------------------------------------

  fn GetWallsFromSpline splineObj =
  (
    -- Default values (can be overridden per-object via user properties)
    local defThickness = 0.2
    local defHeight    = 3.0
    local defColor     = "#cccccc"

    -- Read overrides from user properties
    local propThickness = getUserProp splineObj "wallThickness"
    local propHeight    = getUserProp splineObj "wallHeight"
    local propColor     = getUserProp splineObj "wallColor"

    local thickness = if propThickness != undefined then (propThickness as float) else defThickness
    local height    = if propHeight    != undefined then (propHeight    as float) else defHeight
    local color     = if propColor     != undefined then (propColor     as string) else defColor

    local walls = #()
    if (classOf splineObj == SplineShape) or (classOf splineObj == Line) then
    (
      local nk       = numKnots splineObj 1
      local closed   = isClosed splineObj 1
      local totalSeg = if closed then nk else (nk - 1)

      for k = 1 to totalSeg do
      (
        local nextK  = if k == nk then 1 else (k + 1)
        local p1     = getKnotPoint splineObj 1 k
        local p2     = getKnotPoint splineObj 1 nextK
        local wallId = "wall-" + (k as string)
        -- Negate Y: Max Y (forward) -> Three.js -Z (stored as second component)
        -- Three.js reads startPoint/endPoint as [x, z] directly, no runtime conversion needed
        append walls #(wallId, #(p1.x, -p1.y), #(p2.x, -p2.y), thickness, height, color)
      )
    )
    walls
  )

  --------------------------------------------------------------------------
  -- Find the room spline in the scene
  --   Priority: object named "Room"  >  first SplineShape  >  first Line
  --------------------------------------------------------------------------

  fn FindRoomSpline =
  (
    local found = undefined
    for obj in objects do
    (
      if (classOf obj == SplineShape) or (classOf obj == Line) then
      (
        if found == undefined do found = obj       -- first spline fallback
        if obj.name == "Room" then ( found = obj; exit )
      )
    )
    found
  )

  --------------------------------------------------------------------------
  -- Write metadata.json
  --   {
  --     "polygon": [...],   <- 2D room outline from spline
  --     "walls":   [...],   <- generated from spline segments
  --     "objects": [...]    <- GLB furniture/objects
  --   }
  --------------------------------------------------------------------------

  fn WriteMetadataJson glbPath splineObj objectMetadata =
  (
    local jsonPath = glbPath + "metadata.json"
    local fStream  = createFile jsonPath

    format "{\n" to:fStream

    -- ---- polygon -------------------------------------------------------
    local polyPts = #()
    if splineObj != undefined do polyPts = GetSplinePolygon splineObj

    format "  \"polygon\": [\n" to:fStream
    if polyPts.count > 0 then
    (
      for i = 1 to polyPts.count do
      (
        local px = formattedPrint polyPts[i][1] format:".6f"
        local py = formattedPrint polyPts[i][2] format:".6f"
        if i < polyPts.count then
          format "    [%, %],\n" px py to:fStream
        else
          format "    [%, %]\n"  px py to:fStream
      )
    )
    format "  ],\n\n" to:fStream

    -- ---- walls ---------------------------------------------------------
    local walls = #()
    if splineObj != undefined do walls = GetWallsFromSpline splineObj

    format "  \"walls\": [\n" to:fStream
    for i = 1 to walls.count do
    (
      local w   = walls[i]
      local wId = EscapeJsonString (w[1] as string)
      local sx  = formattedPrint w[2][1] format:".6f"
      local sy  = formattedPrint w[2][2] format:".6f"
      local ex  = formattedPrint w[3][1] format:".6f"
      local ey  = formattedPrint w[3][2] format:".6f"
      local th  = formattedPrint w[4]    format:".4f"
      local ht  = formattedPrint w[5]    format:".4f"
      local cl  = EscapeJsonString (w[6] as string)

      format "    {\n"                                                   to:fStream
      format "      \"id\": \"%\",\n"               wId                 to:fStream
      format "      \"startPoint\": [%, %],\n"      sx sy               to:fStream
      format "      \"endPoint\": [%, %],\n"        ex ey               to:fStream
      format "      \"thickness\": %,\n"            th                  to:fStream
      format "      \"height\": %,\n"               ht                  to:fStream
      format "      \"color\": \"%\"\n"             cl                  to:fStream

      if i < walls.count then format "    },\n" to:fStream
      else                     format "    }\n"  to:fStream
    )
    format "  ],\n\n" to:fStream

    -- ---- objects -------------------------------------------------------
    format "  \"objects\": [\n" to:fStream
    for i = 1 to objectMetadata.count do
    (
      local e   = objectMetadata[i]
      local id  = EscapeJsonString (e[1]  as string)
      local nm  = EscapeJsonString (e[2]  as string)
      local cat = EscapeJsonString (e[3]  as string)
      local shp = EscapeJsonString (e[4]  as string)
      local ssx = formattedPrint   e[5]  format:".4f"
      local ssy = formattedPrint   e[6]  format:".4f"
      local ssz = formattedPrint   e[7]  format:".4f"
      local plt = EscapeJsonString (e[8]  as string)
      local col = EscapeJsonString (e[9]  as string)
      local url = EscapeJsonString (e[10] as string)
      local px  = formattedPrint   e[11] format:".4f"
      local py  = formattedPrint   e[12] format:".4f"
      local pz  = formattedPrint   e[13] format:".4f"
      local rx  = formattedPrint   e[14] format:".6f"
      local ry  = formattedPrint   e[15] format:".6f"
      local rz  = formattedPrint   e[16] format:".6f"
      local rw  = formattedPrint   e[17] format:".6f"

      format "    {\n"                                                                        to:fStream
      format "      \"id\": \"%\",\n"                              id                        to:fStream
      format "      \"name\": \"%\",\n"                            nm                        to:fStream
      format "      \"category\": \"%\",\n"                        cat                       to:fStream
      format "      \"type\": \"%\",\n"                           shp                       to:fStream
      format "      \"size\": [%, %, %],\n"                        ssx ssy ssz               to:fStream
      format "      \"placementType\": \"%\",\n"                   plt                       to:fStream
      format "      \"color\": \"%\",\n"                           col                       to:fStream
      format "      \"modelUrl\": \"%\",\n"                        url                       to:fStream
      format "      \"position\": { \"x\": %, \"y\": %, \"z\": % },\n"     px py pz         to:fStream
      format "      \"rotation\": { \"x\": %, \"y\": %, \"z\": %, \"w\": % }\n" rx ry rz rw to:fStream

      if i < objectMetadata.count then format "    },\n" to:fStream
      else                              format "    }\n"  to:fStream
    )
    format "  ]\n" to:fStream
    format "}\n"   to:fStream

    close fStream
    free  fStream
  )

  --------------------------------------------------------------------------
  -- Export to Groups (Scene)  -  main entry point
  --------------------------------------------------------------------------

  fn ExportGroupsScene glbPath =
  (
    if not doesFileExist glbPath do makeDir glbPath

    local metadata       = #()
    local processedNodes = #{}

    -- Pass 1: export top-level groups
    for obj in objects where (isGroupHead obj) and (obj.parent == undefined or not isGroupHead obj.parent) do
    (
      local members     = CollectGroupMembers obj
      for m in members do processedNodes[m.inode.handle] = true
      setGroupOpen obj true
      local exportedName = ExportNodesToGLB glbPath obj.name members
      setGroupOpen obj false
      local pos = GetObjectPosition members
      local sz  = GetBoundingBoxSize members
      local rot = GetObjectRotationYUp members
      append metadata (BuildExportMetadataRecord obj exportedName sz pos rot members)
    )

    -- Pass 2: export ungrouped geometry
    for obj in objects where (superClassOf obj == GeometryClass) and (not isGroupHead obj) and (not isGroupMember obj) do
    (
      if processedNodes[obj.inode.handle] == false then
      (
        processedNodes[obj.inode.handle] = true
        local exportedName = ExportNodesToGLB glbPath obj.name #(obj)
        local pos = obj.pos
        local sz  = GetBoundingBoxSize #(obj)
        local rot = GetObjectRotationYUp #(obj)
        append metadata (BuildExportMetadataRecord obj exportedName sz pos rot #(obj))
      )
    )

    -- Find room spline and write metadata.json
    local roomSpline = FindRoomSpline()

    WriteMetadataJson glbPath roomSpline metadata

    local splineInfo = if roomSpline != undefined then
      ("\nRoom spline found: \"" + roomSpline.name + "\"\npolygon + walls included.")
    else
      ("\nNo spline named 'Room' found.\npolygon and walls will be empty arrays.\nDraw a closed spline and name it 'Room' to include room data.")

    messageBox ("Exported " + (metadata.count as string) + " GLB file(s)\nmetadata.json written to:\n" + glbPath + splineInfo)
  )

  --------------------------------------------------------------------------
  -- Rollout UI
  --------------------------------------------------------------------------

  try(cui.UnRegisterDialogBar CoronaVrayToGLB)catch()
  try(DestroyDialog CoronaVrayToGLB)catch()

  rollout CoronaVrayToGLB ("Corona Vray To GLB " + scriptVersion)
  (
    group "GLB Export Directory"
    (
      edittext et_path "" across:2 align:#left width:230 readonly:true
      button btn_browse "..." align:#right width:22 height:22 tooltip:"Change GLB Export Directory"
    )

    group "Settings"
    (
      checkbox chk_findTex       "Find Missing Bitmaps"                 checked:false tooltip:"Search directory for missing bitmaps matching prefix."
      checkbox chk_glassToTrans  "Convert Glass to Transmission"        checked:false tooltip:"Enables Transmission for any material using Refraction."
      checkbox chk_GlbCompliant  "Convert Textures to GLB Compliant"    checked:true  tooltip:"Converts non-compliant bitmaps (eg. .tif) to .jpg"
      checkbox chk_invertGloss   "Convert Glossiness Textures (slow)"   checked:true  tooltip:"Inverts Glossiness textures to Roughness. Slow - rebuilds bitmaps."
      checkbox chk_renameGltfMaps "Rename GLTF Maps"                    checked:true  tooltip:"Renames GLTF map nodes to readable names (Base Color, Roughness etc)"
      checkbox chk_rmLog         "Remove GLB .log file"                 checked:true  tooltip:"Deletes .log file after export"
      checkbox chk_rmSubdiv      "Remove Subdivision Modifiers"         checked:true  tooltip:"Removes OpenSubdiv, TurboSmooth, MeshSmooth modifiers"
      checkbox chk_rmMultiSub    "Collapse Multi-Sub Materials"         checked:false tooltip:"WARNING: Replaces Multi-Sub with the sub-material with most textures. USE WITH CAUTION."
      checkbox chk_hWarnings     "Hide Warning Popups (Missing Textures)" checked:false tooltip:"Hides popup warnings for missing textures. Still prints to listener."
    )

    group "Convert Materials"
    (
      checkbox chk_cSelMat "Convert Materials (Selected)" checked:true tooltip:"Convert materials of selected objects only. Unchecked = all scene materials."
      button btn_convertMtl "Convert Materials" tooltip:"Converts Vray or Corona materials to GLTF materials"
    )

    group "Export"
    (
      checkbox chk_xpSel        "Export Selected (Individual)"  checked:true  tooltip:"Exports each selected object as its own .glb file"
      checkbox chk_xpSelCombine "Export Selected (Combined)"    checked:false tooltip:"Exports all selected objects as one combined .glb"
      checkbox chk_xpAll        "Export All (Scene)"            checked:false tooltip:"Exports entire scene as one .glb"
      checkbox chk_xpGroups     "Export to Groups (Scene)"      checked:false tooltip:"Groups -> single .glb, ungrouped -> individual .glb.\nGenerates metadata.json with polygon, walls, and objects.\nDraw a closed spline named 'Room' for polygon/wall data."
      edittext et_exportName "" tooltip:"GLB filename for combined exports (no .glb extension needed)"
      button btn_exportGlb "Export GLB File(s)" tooltip:"Export to the GLB Export Directory"
    )

    group "Customization"
    (
      button btn_saveSettings    "Save Settings as Default"   tooltip:"Save current settings"
      button btn_restoreSettings "Restore Original Settings"  tooltip:"Reset to factory defaults"
    )

    group "Contact"
    (
      label lbl_name "A-Star Group" align:#left
      hyperlink hyp_site "https://a-star.group/" align:#left color:(color 92 216 157) hovercolor:(color 0 150 150) visitedcolor:(color 0 200 200) address:"https://a-star.group/"
      label lbl_spacer1
    )

    -- ---- Open ----
    on CoronaVrayToGLB open do
    (
      if doesFileExist savedSettings then
      (
        local fStream = openfile savedSettings
        while not eof fStream do
        (
          et_path.text              = readLine fStream
          chk_findTex.state         = if not eof fStream then (readValue fStream) == 1 else false
          chk_renameGltfMaps.state  = if not eof fStream then (readValue fStream) == 1 else false
          chk_rmLog.state           = if not eof fStream then (readValue fStream) == 1 else false
          chk_rmSubdiv.state        = if not eof fStream then (readValue fStream) == 1 else false
          chk_rmMultiSub.state      = if not eof fStream then (readValue fStream) == 1 else false
          chk_hWarnings.state       = if not eof fStream then (readValue fStream) == 1 else false
          chk_cSelMat.state         = if not eof fStream then (readValue fStream) == 1 else false
          chk_xpSel.state           = if not eof fStream then (readValue fStream) == 1 else false
          chk_xpSelCombine.state    = if not eof fStream then (readValue fStream) == 1 else false
          chk_xpAll.state           = if not eof fStream then (readValue fStream) == 1 else false
          chk_glassToTrans.state    = if not eof fStream then (readValue fStream) == 1 else false
          chk_invertGloss.state     = if not eof fStream then (readValue fStream) == 1 else false
          chk_GlbCompliant.state    = if not eof fStream then (readValue fStream) == 1 else false
          chk_xpGroups.state        = if not eof fStream then (readValue fStream) == 1 else false
        )
        close fStream; free fStream
        ForceCompleteRedraw()
        if chk_xpSel.state do et_exportName.visible = false
      )
      else
      (
        et_path.text        = defaultExportDirectory
        et_exportName.text  = ""
        et_exportName.visible = false
      )
    )

    -- ---- Browse ----
    on btn_browse pressed do
    (
      local prev = et_path.text
      local dir  = getSavePath caption:"Save Directory"
      et_path.text = if dir != undefined then ((dir as string) + @"\") else prev
    )

    -- ---- Convert Materials ----
    on btn_convertMtl pressed do
    (
      if testMode == true do clearListener()
      renameGltfMaps        = chk_renameGltfMaps.checked
      hideWarningPopups     = chk_hWarnings.checked
      convertGlbCompliant   = chk_GlbCompliant.checked
      findTextures          = chk_findTex.checked
      glassToTransmission   = chk_glassToTrans.checked
      convertGlossinessMaps = chk_invertGloss.checked

      with undo on
      (
        if chk_rmSubdiv.checked  do RemoveSubdivisions()
        if chk_rmMultiSub.checked do CollapseMultiSubs()
        if chk_cSelMat.checked then
          for obj in selection where (selection.count > 0) do
            ( theTarget = obj; ConvertCoronaVray() )
        else
          ( theTarget = rootnode; ConvertCoronaVray() )
      )
      PrintMissingTextures()
    )

    -- ---- Export checkboxes (mutually exclusive) ----
    on chk_xpSel changed state do
    (
      chk_xpSelCombine.checked = false; chk_xpAll.checked = false; chk_xpGroups.checked = false
      et_exportName.visible = false
    )
    on chk_xpSelCombine changed state do
    (
      chk_xpSel.checked = false; chk_xpAll.checked = false; chk_xpGroups.checked = false
      et_exportName.visible = (state == true)
    )
    on chk_xpAll changed state do
    (
      chk_xpSel.checked = false; chk_xpSelCombine.checked = false; chk_xpGroups.checked = false
      et_exportName.visible = (state == true)
    )
    on chk_xpGroups changed state do
    (
      chk_xpSel.checked = false; chk_xpSelCombine.checked = false; chk_xpAll.checked = false
      et_exportName.visible = false
    )

    -- ---- Export GLB ----
    on btn_exportGlb pressed do
    (
      removeGlbLogFile = chk_rmLog.checked
      if chk_xpSel.checked then
      (
        for obj in selection do
        (
          hide selection; unhide obj
          ExportToGLB et_path.text et_exportName.text obj false
          unhide selection
        )
      )
      else if chk_xpSelCombine.checked then
      (
        for obj in selection do ( ExportToGLB et_path.text et_exportName.text obj true; exit )
      )
      else if chk_xpAll.checked then
      (
        ExportToGLB et_path.text et_exportName.text undefined false
      )
      else if chk_xpGroups.checked then
      (
        ExportGroupsScene et_path.text
      )
      else
        messageBox "You must pick one Export checkbox to export to GLB."
    )

    -- ---- Save Settings ----
    on btn_saveSettings pressed do
    (
      local saveDir = getDir(#userScripts) + "\\Vella"
      if not doesDirectoryExist saveDir do makeDir saveDir
      local fStream = createFile savedSettings
      format "%\n"  et_path.text to:fStream
      format "%\n"  (if chk_findTex.state        then 1 else 0) to:fStream
      format "%\n"  (if chk_renameGltfMaps.state  then 1 else 0) to:fStream
      format "%\n"  (if chk_rmLog.state           then 1 else 0) to:fStream
      format "%\n"  (if chk_rmSubdiv.state        then 1 else 0) to:fStream
      format "%\n"  (if chk_rmMultiSub.state      then 1 else 0) to:fStream
      format "%\n"  (if chk_hWarnings.state       then 1 else 0) to:fStream
      format "%\n"  (if chk_cSelMat.state         then 1 else 0) to:fStream
      format "%\n"  (if chk_xpSel.state           then 1 else 0) to:fStream
      format "%\n"  (if chk_xpSelCombine.state    then 1 else 0) to:fStream
      format "%\n"  (if chk_xpAll.state           then 1 else 0) to:fStream
      format "%\n"  (if chk_glassToTrans.state    then 1 else 0) to:fStream
      format "%\n"  (if chk_invertGloss.state     then 1 else 0) to:fStream
      format "%\n"  (if chk_GlbCompliant.state    then 1 else 0) to:fStream
      format "%\n"  (if chk_xpGroups.state        then 1 else 0) to:fStream
      close fStream; free fStream
      ForceCompleteRedraw()
    )

    -- ---- Restore Settings ----
    on btn_restoreSettings pressed do
    (
      if doesFileExist savedSettings do deleteFile savedSettings
      et_path.text              = defaultExportDirectory
      chk_findTex.checked       = false
      chk_renameGltfMaps.checked = true
      chk_rmLog.checked         = true
      chk_rmSubdiv.checked      = true
      chk_rmMultiSub.checked    = false
      chk_hWarnings.checked     = false
      chk_cSelMat.checked       = true
      chk_xpSel.checked         = true
      chk_xpSelCombine.checked  = false
      chk_xpAll.checked         = false
      chk_xpGroups.checked      = false
      et_exportName.visible     = false
      chk_glassToTrans.checked  = false
      chk_invertGloss.checked   = true
      chk_GlbCompliant.checked  = true
    )

  ) -- end rollout

  if testMode == false then
  (
    CreateDialog CoronaVrayToGLB POS:[100,200] width:300 height:700
    cui.RegisterDialogBar CoronaVrayToGLB
  )
  else
  (
    CreateDialog CoronaVrayToGLB POS:[100,200] width:300 height:700
    cui.RegisterDialogBar CoronaVrayToGLB
    CoronaVrayToGLB.btn_convertMtl.pressed()
    try(cui.UnRegisterDialogBar CoronaVrayToGLB)catch()
    try(DestroyDialog CoronaVrayToGLB)catch()
  )

)

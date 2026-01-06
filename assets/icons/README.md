# Иконки расширения

Для полноценной работы расширения необходимо создать PNG иконки следующих размеров:
- icon16.png (16x16)
- icon48.png (48x48)
- icon128.png (128x128)

## Создание иконок

Вы можете использовать файл `icon.svg` как основу и экспортировать его в нужные размеры с помощью:

### Онлайн инструменты:
- https://www.iloveimg.com/resize-image
- https://www.img2go.com/resize-image

### Командная строка (ImageMagick):
```bash
# Установка ImageMagick (если не установлен)
brew install imagemagick  # macOS
sudo apt-get install imagemagick  # Linux

# Конвертация SVG в PNG
convert icon.svg -resize 16x16 icon16.png
convert icon.svg -resize 48x48 icon48.png
convert icon.svg -resize 128x128 icon128.png
```

### Figma/Sketch/Adobe XD:
1. Откройте icon.svg
2. Экспортируйте в PNG с нужными размерами

## Временное решение

Пока иконки не созданы, расширение будет использовать стандартные иконки Chrome.
Для разработки это не критично, но для публикации в Chrome Web Store иконки обязательны.


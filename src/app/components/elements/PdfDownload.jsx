import React from 'react';
import QRious from 'qrious';
import jsPDF from 'jspdf';
import RobotoRegular from 'app/assets/fonts/Roboto-Regular.ttf';
import RobotoBold from 'app/assets/fonts/Roboto-Bold.ttf';
import RobotoMonoRegular from 'app/assets/fonts/RobotoMono-Regular.ttf';
import pdfLogoSvg from 'app/assets/images/pdf-logo.svg';

function image2canvas(image, bgcolor) {
    var canvas = document.createElement('canvas');
    canvas.width = image.width * 32;
    canvas.height = image.height * 32;

    var ctx = canvas.getContext('2d');
    ctx.fillStyle = bgcolor;
    ctx.fillRect(0.0, 0.0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    return canvas;
}

class PdfDownload extends React.Component {
    constructor(props) {
        super(props);
        this.renderPdf = this.renderPdf.bind(this);
    }

    componentDidUpdate(prevProps) {
        if (this.props.dlPdf && !prevProps.dlPdf) {
            try {
                var keys = this.props.keys;
                var name = this.props.name;
                var filename = 'Keys for @' + name + '.pdf';
                this.renderPdf(keys, name, filename).save(filename);
            } catch (error) {
                console.error(error);
            }
            if (this.props.resetDlPdf) {
                this.props.resetDlPdf();
            }
        }
    }

    drawFilledRect(ctx, x, y, w, h, options) {
        ctx.setDrawColor(0);
        ctx.setFillColor(options.color);
        ctx.rect(x, y, w, h, 'F');
    }

    drawImageFromCanvas(ctx, selector, x, y, w, h, bgcolor) {
        var el = document.querySelector(selector);
        if (!el) return;
        var canvas = image2canvas(el, bgcolor);
        ctx.addImage(canvas, 'JPEG', x, y, w, h);
    }

    drawQr(ctx, data, x, y, size, bgcolor) {
        var canvas = document.createElement('canvas');
        new QRious({
            element: canvas,
            size: 250,
            value: data,
            background: bgcolor,
        });
        ctx.addImage(canvas, 'PNG', x, y, size, size);
    }

    renderText(ctx, text, options) {
        var textLines = ctx
            .setFont(options.font)
            .setFontSize(options.fontSize * options.scale)
            .setTextColor(options.color)
            .splitTextToSize(text, options.maxWidth);
        ctx.text(textLines, options.x, options.y + options.fontSize);
        return textLines.length * options.fontSize * options.lineHeight;
    }

    renderPdf(keys, name, filename) {
        var widthInches = this.props.widthInches || 8.5;
        var lineHeight = 1.2;
        var margin = 0.3;
        var maxLineWidth = widthInches - margin * 2.0;
        var scale = 72;
        var qrSize = 1.1;

        var ctx = new jsPDF({
            orientation: 'portrait',
            unit: 'in',
            lineHeight: lineHeight,
            format: 'letter',
        }).setProperties({ title: filename });

        ctx.addFont(RobotoRegular, 'Roboto-Regular', 'normal');
        ctx.addFont(RobotoBold, 'Roboto-Bold', 'normal');
        ctx.addFont(RobotoMonoRegular, 'RobotoMono-Regular', 'normal');

        var offset = 0.0;
        var sectionStart = 0;
        var sectionHeight = 0;

        // HEADER
        sectionHeight = 1.29;
        this.drawFilledRect(ctx, 0.0, 0.0, widthInches, sectionHeight, {
            color: '#1f0fd1',
        });

        this.drawImageFromCanvas(
            ctx,
            '.pdf-logo',
            widthInches - margin - 1.9,
            0.36,
            0.98 * 1.8,
            0.3 * 1.8,
            '#1F0FD1'
        );

        offset += 0.265;
        offset += this.renderText(ctx, 'Keys for @' + name, {
            scale: scale,
            x: margin,
            y: offset,
            lineHeight: 1.0,
            maxWidth: maxLineWidth,
            color: 'white',
            fontSize: 0.36,
            font: 'Roboto-Bold',
        });

        offset += 0.15;
        offset += this.renderText(
            ctx,
            'Generated at ' +
                new Date()
                    .toISOString()
                    .replace(/\.\d{3}/, '') +
                ' by steemit.com',
            {
                scale: scale,
                x: margin,
                y: offset,
                lineHeight: 1.0,
                maxWidth: maxLineWidth,
                color: 'white',
                fontSize: 0.14,
                font: 'Roboto-Bold',
            }
        );

        offset = sectionStart + sectionHeight;

        // BODY - PRIVATE KEYS INTRO
        offset += 0.1;
        offset += this.renderText(
            ctx,
            'Instead of password based authentication, blockchain accounts ' +
                'have a set of public and private key pairs that are used for ' +
                'authentication as well as the encryption and decryption of ' +
                'data. Do not share this file with anyone.',
            {
                scale: scale,
                x: margin,
                y: offset,
                lineHeight: lineHeight,
                maxWidth: maxLineWidth,
                color: 'black',
                fontSize: 0.14,
                font: 'Roboto-Regular',
            }
        );

        // Steemit Account
        offset += 0.4;
        offset += this.renderText(ctx, 'Your Steemit Private Keys', {
            scale: scale,
            x: margin,
            y: offset,
            lineHeight: lineHeight,
            maxWidth: maxLineWidth,
            color: 'black',
            fontSize: 0.18,
            font: 'Roboto-Bold',
        });
        offset += 0.1;

        // POSTING KEY
        sectionStart = offset;
        sectionHeight = qrSize + 0.15 * 2;
        this.drawFilledRect(ctx, 0.0, offset, widthInches, sectionHeight, {
            color: 'f4f4f4',
        });

        offset += 0.15;
        this.drawQr(
            ctx,
            'steem://import/wif/' + keys.postingPrivate + '/account/' + name,
            margin,
            offset,
            qrSize,
            '#f4f4f4'
        );

        offset += 0.1;
        offset += this.renderText(ctx, 'Private Posting Key', {
            scale: scale,
            x: margin + qrSize + 0.1,
            y: offset,
            lineHeight: lineHeight,
            maxWidth: maxLineWidth,
            color: 'black',
            fontSize: 0.14,
            font: 'Roboto-Bold',
        });

        offset += this.renderText(
            ctx,
            'Used to log in to apps such as Steemit.com and perform social ' +
                'actions such as posting, commenting, and voting.',
            {
                scale: scale,
                x: margin + qrSize + 0.1,
                y: offset,
                lineHeight: lineHeight,
                maxWidth: maxLineWidth - (qrSize + 0.1),
                color: 'black',
                fontSize: 0.14,
                font: 'Roboto-Regular',
            }
        );

        offset += 0.075;
        offset += this.renderText(ctx, keys.postingPrivate, {
            scale: scale,
            x: margin + qrSize + 0.1,
            y: sectionStart + sectionHeight - 0.6,
            lineHeight: lineHeight,
            maxWidth: maxLineWidth,
            color: 'black',
            fontSize: 0.14,
            font: 'RobotoMono-Regular',
        });
        offset += 0.2;
        offset = sectionStart + sectionHeight;

        // MEMO KEY
        sectionStart = offset;
        sectionHeight = qrSize + 0.15 * 2;

        offset += 0.15;
        this.drawQr(
            ctx,
            'steem://import/wif/' + keys.memoPrivate + '/account/' + name,
            margin,
            offset,
            qrSize,
            '#ffffff'
        );

        offset += 0.1;
        offset += this.renderText(ctx, 'Private Memo Key', {
            scale: scale,
            x: margin + qrSize + 0.1,
            y: offset,
            lineHeight: lineHeight,
            maxWidth: maxLineWidth,
            color: 'black',
            fontSize: 0.14,
            font: 'Roboto-Bold',
        });

        offset += this.renderText(ctx, 'Used to decrypt private transfer memos.', {
            scale: scale,
            x: margin + qrSize + 0.1,
            y: offset,
            lineHeight: lineHeight,
            maxWidth: maxLineWidth - (qrSize + 0.1),
            color: 'black',
            fontSize: 0.14,
            font: 'Roboto-Regular',
        });

        offset += 0.075;
        offset += this.renderText(ctx, keys.memoPrivate, {
            scale: scale,
            x: margin + qrSize + 0.1,
            y: sectionStart + sectionHeight - 0.6,
            lineHeight: lineHeight,
            maxWidth: maxLineWidth,
            color: 'black',
            fontSize: 0.14,
            font: 'RobotoMono-Regular',
        });

        offset += 0.1;
        offset = sectionStart + sectionHeight;

        // ACTIVE KEY
        sectionStart = offset;
        sectionHeight = qrSize + 0.15 * 2;
        this.drawFilledRect(ctx, 0.0, offset, widthInches, sectionHeight, {
            color: '#f4f4f4',
        });

        offset += 0.15;
        this.drawQr(
            ctx,
            'steem://import/wif/' + keys.activePrivate + '/account/' + name,
            margin,
            offset,
            qrSize,
            '#f4f4f4'
        );

        offset += 0.1;
        offset += this.renderText(ctx, 'Private Active Key', {
            scale: scale,
            x: margin + qrSize + 0.1,
            y: offset,
            lineHeight: lineHeight,
            maxWidth: maxLineWidth,
            color: 'black',
            fontSize: 0.14,
            font: 'Roboto-Bold',
        });

        offset += this.renderText(
            ctx,
            'Used for monetary and wallet related actions, such as ' +
                'transferring tokens or powering STEEM up and down.',
            {
                scale: scale,
                x: margin + qrSize + 0.1,
                y: offset,
                lineHeight: lineHeight,
                maxWidth: maxLineWidth - (qrSize + 0.1),
                color: 'black',
                fontSize: 0.14,
                font: 'Roboto-Regular',
            }
        );

        offset += 0.075;
        offset += this.renderText(ctx, keys.activePrivate, {
            scale: scale,
            x: margin + qrSize + 0.1,
            y: sectionStart + sectionHeight - 0.6,
            lineHeight: lineHeight,
            maxWidth: maxLineWidth,
            color: 'black',
            fontSize: 0.14,
            font: 'RobotoMono-Regular',
        });
        offset += 0.6;

        // OWNER KEY
        sectionStart = offset;
        sectionHeight = qrSize + 0.15 * 2;

        offset += 0.15;
        this.drawQr(
            ctx,
            'steem://import/wif/' + keys.ownerPrivate + '/account/' + name,
            margin,
            offset,
            qrSize,
            '#ffffff'
        );

        offset += 0.1;
        offset += this.renderText(ctx, 'Private Owner Key', {
            scale: scale,
            x: margin + qrSize + 0.1,
            y: offset,
            lineHeight: lineHeight,
            maxWidth: maxLineWidth - qrSize - 0.1,
            color: 'black',
            fontSize: 0.14,
            font: 'Roboto-Bold',
        });

        offset += this.renderText(
            ctx,
            'This key is used to reset all your other keys. It is ' +
                'recommended to keep it offline at all times. If your ' +
                'account is compromised, use this key to recover it ' +
                'within 30 days at https://steemitwallet.com.',
            {
                scale: scale,
                x: margin + qrSize + 0.1,
                y: offset,
                lineHeight: lineHeight,
                maxWidth: maxLineWidth - (qrSize + 0.1),
                color: 'black',
                fontSize: 0.14,
                font: 'Roboto-Regular',
            }
        );

        offset += 0.075;
        offset += this.renderText(ctx, keys.ownerPrivate, {
            scale: scale,
            x: margin + qrSize + 0.1,
            y: sectionStart + sectionHeight - 0.6,
            lineHeight: lineHeight,
            maxWidth: maxLineWidth - qrSize - 0.1,
            color: 'black',
            fontSize: 0.14,
            font: 'RobotoMono-Regular',
        });

        offset = sectionStart + sectionHeight;

        // MASTER PASSWORD
        sectionHeight = 1;
        sectionStart = offset;
        this.drawFilledRect(ctx, 0.0, offset, widthInches, sectionHeight, {
            color: '#f4f4f4',
        });

        offset += 0.2;
        offset += this.renderText(ctx, 'Master Password', {
            scale: scale,
            x: margin,
            y: offset,
            lineHeight: lineHeight,
            maxWidth: maxLineWidth,
            color: 'black',
            fontSize: 0.14,
            font: 'Roboto-Bold',
        });

        offset += this.renderText(
            ctx,
            'The seed password used to generate this document. ' +
                'Do not share this key.',
            {
                scale: scale,
                x: margin,
                y: offset,
                lineHeight: lineHeight,
                maxWidth: maxLineWidth,
                color: 'black',
                fontSize: 0.14,
                font: 'Roboto-Regular',
            }
        );

        offset += 0.075;
        offset += this.renderText(ctx, keys.master || this.props.password || '', {
            scale: scale,
            x: margin,
            y: offset,
            lineHeight: lineHeight,
            maxWidth: maxLineWidth,
            color: 'black',
            fontSize: 0.14,
            font: 'RobotoMono-Regular',
        });

        offset = sectionStart + sectionHeight;

        // PUBLIC KEYS INTRO
        sectionStart = offset;
        sectionHeight = 1.0;

        offset += 0.1;
        offset += this.renderText(ctx, 'Your Steemit Public Keys', {
            scale: scale,
            x: margin,
            y: offset,
            lineHeight: lineHeight,
            maxWidth: maxLineWidth,
            color: 'black',
            fontSize: 0.18,
            font: 'Roboto-Bold',
        });

        offset += 0.1;
        offset += this.renderText(
            ctx,
            'Public keys are associated with usernames and are used to ' +
                'encrypt and verify messages. Your public keys are not required ' +
                'for login. You can view these anytime at: https://steemscan.com/account/' +
                name,
            {
                scale: scale,
                x: margin,
                y: offset,
                lineHeight: lineHeight,
                maxWidth: maxLineWidth,
                color: 'black',
                fontSize: 0.15,
                font: 'Roboto-Regular',
            }
        );

        offset = sectionStart + sectionHeight;

        // PUBLIC KEYS
        this.renderText(ctx, 'Posting Public', {
            scale: scale,
            x: margin,
            y: offset,
            lineHeight: lineHeight,
            maxWidth: maxLineWidth,
            color: 'black',
            fontSize: 0.14,
            font: 'Roboto-Bold',
        });

        offset += this.renderText(ctx, keys.postingPublic, {
            scale: scale,
            x: 1.25,
            y: offset,
            lineHeight: lineHeight,
            maxWidth: maxLineWidth,
            color: 'black',
            fontSize: 0.14,
            font: 'RobotoMono-Regular',
        });

        this.renderText(ctx, 'Memo Public', {
            scale: scale,
            x: margin,
            y: offset,
            lineHeight: lineHeight,
            maxWidth: maxLineWidth,
            color: 'black',
            fontSize: 0.14,
            font: 'Roboto-Bold',
        });

        offset += this.renderText(ctx, keys.memoPublic, {
            scale: scale,
            x: 1.25,
            y: offset,
            lineHeight: lineHeight,
            maxWidth: maxLineWidth,
            color: 'black',
            fontSize: 0.14,
            font: 'RobotoMono-Regular',
        });

        this.renderText(ctx, 'Active Public', {
            scale: scale,
            x: margin,
            y: offset,
            lineHeight: lineHeight,
            maxWidth: maxLineWidth,
            color: 'black',
            fontSize: 0.14,
            font: 'Roboto-Bold',
        });

        offset += this.renderText(ctx, keys.activePublic, {
            scale: scale,
            x: 1.25,
            y: offset,
            lineHeight: lineHeight,
            maxWidth: maxLineWidth,
            color: 'black',
            fontSize: 0.14,
            font: 'RobotoMono-Regular',
        });

        this.renderText(ctx, 'Owner Public', {
            scale: scale,
            x: margin,
            y: offset,
            lineHeight: lineHeight,
            maxWidth: maxLineWidth,
            color: 'black',
            fontSize: 0.14,
            font: 'Roboto-Bold',
        });

        offset += this.renderText(ctx, keys.ownerPublic, {
            scale: scale,
            x: 1.25,
            y: offset,
            lineHeight: lineHeight,
            maxWidth: maxLineWidth,
            color: 'black',
            fontSize: 0.14,
            font: 'RobotoMono-Regular',
        });

        this.renderText(ctx, 'v0.1', {
            scale: scale,
            x: maxLineWidth - 0.2,
            y: offset - 0.2,
            lineHeight: lineHeight,
            maxWidth: maxLineWidth,
            color: '#bbbbbb',
            fontSize: 0.14,
            font: 'Roboto-Regular',
        });

        return ctx;
    }

    render() {
        // The SVG from svg-inline-loader is raw markup; we wrap it in a data URI
        // so it can be rendered as an <img> for canvas conversion.
        var svgDataUri =
            'data:image/svg+xml;base64,' +
            (typeof btoa !== 'undefined'
                ? btoa(pdfLogoSvg)
                : '');

        return (
            <div className="pdf-download" style={{ visibility: 'hidden', position: 'absolute', left: '-9999px' }}>
                <img
                    alt=""
                    src={svgDataUri}
                    style={{ display: 'none' }}
                    className="pdf-logo"
                    width="98"
                    height="30"
                />
            </div>
        );
    }
}

export default PdfDownload;

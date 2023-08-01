import React from 'react';
import copy from 'app/assets/images/copy.png';
import { CopyToClipboard } from 'react-copy-to-clipboard';
import tt from 'counterpart';
import Toast from 'app/components/elements/Toast';

export default class CopyPassword extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            password: '',
            showToast: false,
            copySuccess: false,
        };
        this.copySuccess = this.copySuccess.bind(this);
        this.close = this.close.bind(this);
    }

    copySuccess() {
        this.setState({
            copySuccess: true,
            showToast: true,
        });
        setTimeout(() => {
            this.setState({
                showToast: false,
            });
        }, 2000);
    }

    close() {
        if (!this.state.copySuccess) return;
        this.props.close();
        this.setState({
            copySuccess: false,
        });
    }
    render() {
        return (
            <div>
                {this.props.visible ? (
                    <div className="copy_password">
                        <div className="copy_password_cover" />
                        <div className="copy_password_modal">
                            <div className="title">
                                {tt('copy_password.back_up')}
                            </div>
                            <div className="content">
                                {tt('copy_password.back_up_tips')}
                            </div>
                            <div className="input_password">
                                {this.props.newWif}
                                <CopyToClipboard
                                    text={this.props.newWif}
                                    onCopy={this.copySuccess}
                                >
                                    <img src={copy} />
                                </CopyToClipboard>
                            </div>
                            <div
                                className={`footer ${
                                    this.state.copySuccess ? 'footer_blue' : ''
                                }`}
                                onClick={this.close}
                            >
                                {tt('copy_password.back_up_success')}
                            </div>
                        </div>
                    </div>
                ) : null}
                {
                    <Toast
                        text={tt('copy_password.copy_success')}
                        showToast={this.state.showToast}
                    />
                }
            </div>
        );
    }
}

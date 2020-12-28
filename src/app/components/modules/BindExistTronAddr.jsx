/* eslint-disable no-useless-escape */
import React, { Component } from 'react';
import tt from 'counterpart';
import { connect } from 'react-redux';
import * as userActions from 'app/redux/UserReducer';
import * as appActions from 'app/redux/AppReducer';
import { isTronAddr, updateCustomTronAddr } from 'app/utils/tronApi';
import LoadingIndicator from 'app/components/elements/LoadingIndicator';

const styles = {
    container: {
        display: 'flex',
        flexDirection: 'row',
        flexFlow: 'row wrap',
        marginTop: '40px',
    },
    flowBelow: {
        marginTop: '40px',
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
    },
    box: {
        paddingRight: '20px',
        paddingLeft: '20px',
    },
};
// todo: refactor with tronCreateOne
class BindExistTronAddr extends Component {
    constructor() {
        super();
        this.state = {
            page: 1,
            tronAddr: '',
            tronAddrCheckStatus: true,
            confirmTronAddrBtnStatus: true,
            submitBtnStatus: true,
            errMsg: '',
            password: '',
            loading: false,
            updateErrMsg: '',
        };
        this.goToPage = this.goToPage.bind(this);
        this.confirmTronAddr = this.confirmTronAddr.bind(this);
        this.submit = this.submit.bind(this);
    }

    goToPage(pageId) {
        if (!pageId) return;
        this.setState({
            page: pageId,
        });
    }

    confirmTronAddr() {
        const { tronAddr } = this.state;
        if (isTronAddr(tronAddr)) {
            this.goToPage(3);
        } else {
            this.setState({
                errMsg: 'userwallet_jsx.incorrect_account_format',
            });
        }
    }

    submit() {
        const { tronAddr, password } = this.state;
        const { username } = this.props;
        this.setState({
            loading: true,
            updateErrMsg: '',
        });
        updateCustomTronAddr(username, password, tronAddr)
            .then(res => {
                if (res.status === false) {
                    this.setState({
                        loading: false,
                        updateErrMsg: res.err,
                    });
                    return;
                }
                this.props.loadTronInfoAgain(username);
                this.props.hideBindExistTronAddr();
                this.props.notify(tt('userwallet_jsx.successfully_linked'));
            })
            .catch(e => {
                console.error('bind error:', e);
                this.setState({
                    loading: false,
                    updateErrMsg: e.message,
                });
            });
    }

    render() {
        const {
            page,
            confirmTronAddrBtnStatus,
            submitBtnStatus,
            tronAddr,
            errMsg,
            loading,
            updateErrMsg,
        } = this.state;
        const authType = tt('loginform_jsx.active_or_owner');
        return (
            <div>
                {page === 1 && (
                    <div style={styles.box}>
                        <div>
                            <h3>{tt('userwallet_jsx.bind_exist_tron_addr')}</h3>
                        </div>
                        <div style={styles.container}>
                            <div style={styles.container}>
                                <p>
                                    {tt(
                                        'userwallet_jsx.bind_exist_tron_addr_description_1'
                                    )}
                                </p>
                                <p style={{ marginBottom: 0 }}>
                                    {tt(
                                        'userwallet_jsx.bind_exist_tron_addr_description_2'
                                    )}
                                </p>
                                <p style={{ marginBottom: 0 }}>
                                    {tt(
                                        'userwallet_jsx.bind_exist_tron_addr_description_3'
                                    )}
                                </p>
                                <p>
                                    {tt(
                                        'userwallet_jsx.bind_exist_tron_addr_description_4'
                                    )}
                                </p>
                                <p>
                                    {tt(
                                        'userwallet_jsx.bind_exist_tron_addr_description_5'
                                    )}
                                </p>
                                <p>
                                    {tt(
                                        'userwallet_jsx.bind_exist_tron_addr_description_6'
                                    )}
                                </p>
                            </div>
                        </div>
                        <div style={styles.flowBelow}>
                            <button
                                className="button"
                                onClick={() => this.goToPage(2)}
                            >
                                {tt('g.confirm')}
                            </button>
                        </div>
                    </div>
                )}
                {page === 2 && (
                    <div style={styles.box}>
                        <div>
                            <h3>{tt('userwallet_jsx.bind_exist_tron_addr')}</h3>
                        </div>
                        <div style={styles.container}>
                            <p>
                                {tt(
                                    'userwallet_jsx.enter_the_tron_account_addr_you_wish_to_link'
                                )}
                            </p>
                            <div className="input-group">
                                <input
                                    className="input-group-field"
                                    type="text"
                                    required
                                    placeholder={tt('g.input_tron_address')}
                                    value={tronAddr}
                                    onChange={e => {
                                        const newVal = e.target.value.replace(
                                            /[^\w]|[\.\/_]/gi,
                                            ''
                                        );
                                        this.setState({
                                            tronAddr: newVal,
                                            confirmTronAddrBtnStatus:
                                                newVal == '',
                                        });
                                    }}
                                />
                            </div>
                            {errMsg != '' && (
                                <div className="error">{tt(errMsg)}</div>
                            )}
                        </div>
                        <div style={styles.flowBelow}>
                            <button
                                type="submit"
                                className="button"
                                onClick={this.confirmTronAddr}
                                disabled={confirmTronAddrBtnStatus}
                            >
                                {tt('g.confirm')}
                            </button>
                        </div>
                    </div>
                )}
                {page === 3 && (
                    <div style={styles.box}>
                        <div>
                            <h3>{tt('userwallet_jsx.sign_to_link')}</h3>
                        </div>
                        <div style={styles.container}>
                            <div className="input-group">
                                <span className="input-group-label">@</span>
                                <input
                                    className="input-group-field"
                                    type="text"
                                    placeholder={tt(
                                        'loginform_jsx.enter_your_username'
                                    )}
                                    value={this.props.username}
                                    disabled={true}
                                />
                            </div>
                            <div className="input-group">
                                <input
                                    type="password"
                                    required
                                    onChange={e => {
                                        const newVal = e.target.value;
                                        this.setState({
                                            password: newVal,
                                            submitBtnStatus: newVal == '',
                                        });
                                    }}
                                />
                            </div>
                            <div className="info">
                                {tt(
                                    'loginform_jsx.this_operation_requires_your_key_or_master_password',
                                    { authType }
                                )}
                            </div>
                        </div>
                        <div style={styles.flowBelow}>
                            <button
                                type="submit"
                                className="button"
                                onClick={this.submit}
                                disabled={submitBtnStatus}
                            >
                                {tt('g.confirm')}
                            </button>
                            {loading && <LoadingIndicator type="circle" />}
                            {updateErrMsg != '' && (
                                <div className="error">{tt(updateErrMsg)}</div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        );
    }
}

export default connect(
    // mapStateToProps
    (state, ownProps) => {
        const currentUser = state.user.get('current');
        return {
            ...ownProps,
            username: currentUser.has('username')
                ? currentUser.get('username')
                : '',
        };
    },
    dispatch => ({
        hideBindExistTronAddr: () => {
            dispatch(userActions.hideBindExistTronAddr());
        },
        notify: message => {
            dispatch(
                appActions.addNotification({
                    key: 'chpwd_' + Date.now(),
                    message,
                    dismissAfter: 3000,
                })
            );
        },
        loadTronInfoAgain: username => {
            dispatch(userActions.loadTronInfoAgain({ username }));
        },
    })
)(BindExistTronAddr);

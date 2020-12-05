import React, { Component } from 'react';
import tt from 'counterpart';
import { connect } from 'react-redux';
import * as userActions from 'app/redux/UserReducer';
import * as appActions from 'app/redux/AppReducer';
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
};
// todo: refactor with tronCreateOne
class UpdateTronAccountOne extends Component {
    constructor() {
        super();
        this.handleSubmit = e => {
            e.preventDefault();
            this.props.startLoading();
            this.props.updateTronAddr();
        };
    }

    componentWillUpdate(nextProps) {
        const {
            tronPrivateKey,
            showTronUpdateSuccess,
            hideTronUpdate,
        } = nextProps;
        if (tronPrivateKey !== this.props.tronPrivateKey) {
            this.props.endLoading();
            showTronUpdateSuccess();
            hideTronUpdate();
        }
    }

    render() {
        return (
            <div>
                <div>
                    <h3>{tt('tron_jsx.update_tron_account')}</h3>
                </div>
                <div style={styles.container}>
                    <div style={styles.container}>
                        <p> {tt('tron_jsx.update_tron_content')} </p>
                        <p style={{ marginBottom: 0 }}>
                            {' '}
                            {tt('tron_jsx.update_tron_content1')}{' '}
                        </p>
                        <p style={{ marginBottom: 0 }}>
                            {' '}
                            {tt('tron_jsx.update_tron_content2')}{' '}
                        </p>
                        <p> {tt('tron_jsx.update_tron_content3')} </p>
                        <p> {tt('tron_jsx.update_tron_content4')} </p>
                        <p> {tt('tron_jsx.update_tron_content5')} </p>
                    </div>
                </div>
                <div style={styles.flowBelow}>
                    <button
                        type="submit"
                        className="button"
                        onClick={this.handleSubmit}
                        disabled={this.props.loading}
                    >
                        {tt('tron_jsx.update_button')}
                    </button>
                    {this.props.loading && (
                        <span>
                            <LoadingIndicator type="circle" />
                        </span>
                    )}
                </div>
            </div>
        );
    }
}

export default connect(
    // mapStateToProps
    (state, ownProps) => {
        const currentUser = state.user.get('current');
        const tronPrivateKey =
            currentUser && currentUser.has('tron_private_key')
                ? currentUser.get('tron_private_key')
                : '';
        return {
            ...ownProps,
            loading: state.app.get('modalLoading'),
            tronPrivateKey,
        };
    },
    dispatch => ({
        showTronUpdateSuccess: () => {
            dispatch(userActions.showTronUpdateSuccess());
        },
        hideTronUpdate: () => {
            dispatch(userActions.hideTronUpdate());
        },
        updateTronAddr: () => {
            dispatch(userActions.updateTronAddr());
        },
        startLoading: () => {
            dispatch(appActions.modalLoadingBegin());
        },
        endLoading: () => {
            dispatch(appActions.modalLoadingEnd());
        },
    })
)(UpdateTronAccountOne);
